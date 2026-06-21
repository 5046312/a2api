use std::{
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_shell::{process::CommandChild, ShellExt};
use url::Url;
use uuid::Uuid;

struct DesktopState {
    server: Mutex<Option<DesktopServer>>,
}

struct DesktopServer {
    child: CommandChild,
    port: u16,
}

struct DesktopTokens {
    auth_token: String,
    proxy_token: String,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            server: Mutex::new(None),
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(DesktopState::default())
        .setup(|app| {
            setup_tray(app.handle())?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = restart_desktop_server(&handle).await {
                    eprintln!("[a2api-desktop] 启动本地服务失败: {error}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build a2api desktop")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. }) {
                stop_desktop_server(app);
            }
        });
}

async fn restart_desktop_server(app: &tauri::AppHandle) -> Result<(), String> {
    stop_desktop_server(app);
    let server = start_desktop_server(app)?;
    let port = server.port;
    app.state::<DesktopState>()
        .server
        .lock()
        .map_err(|_| "无法锁定桌面服务状态".to_string())?
        .replace(server);

    let health_url = format!("http://127.0.0.1:{port}/api/desktop/health");
    wait_for_health(&health_url, Duration::from_secs(30)).await?;

    let tokens = load_or_create_tokens(&desktop_config_dir(app)?)?;
    let window_url = format!("http://127.0.0.1:{port}/#a2api_desktop_token={}", tokens.auth_token);
    open_main_window(app, &window_url)?;
    Ok(())
}

fn start_desktop_server(app: &tauri::AppHandle) -> Result<DesktopServer, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法读取资源目录: {error}"))?;
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法读取应用数据目录: {error}"))?
        .join("data");
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("无法读取日志目录: {error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建数据目录: {error}"))?;
    fs::create_dir_all(&log_dir).map_err(|error| format!("无法创建日志目录: {error}"))?;

    let tokens = load_or_create_tokens(&desktop_config_dir(app)?)?;
    let port = find_available_port(resolve_preferred_port())?;
    let server_entry = resource_dir.join("dist").join("server").join("index.js");
    if !server_entry.exists() {
        return Err(format!("缺少服务入口: {}", server_entry.display()));
    }

    // sidecar 继承 Tauri 进程环境；这里只写入桌面运行所需的启动级配置。
    std::env::set_var("A2API_DESKTOP", "1");
    std::env::set_var("HOST", "127.0.0.1");
    std::env::set_var("PORT", port.to_string());
    std::env::set_var("DATA_DIR", path_to_string(&data_dir)?);
    std::env::set_var("A2API_LOG_DIR", path_to_string(&log_dir)?);
    std::env::set_var("AUTH_TOKEN", tokens.auth_token);
    std::env::set_var("PROXY_TOKEN", tokens.proxy_token);

    let command = app
        .shell()
        .sidecar("a2api-sidecar")
        .map_err(|error| format!("无法加载 sidecar: {error}"))?
        .arg(path_to_string(&server_entry)?);
    let (mut rx, child) = command
        .spawn()
        .map_err(|error| format!("无法启动 sidecar: {error}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            eprintln!("[a2api-sidecar] {event:?}");
        }
    });

    Ok(DesktopServer { child, port })
}

fn stop_desktop_server(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    if let Ok(mut guard) = state.server.lock() {
        if let Some(server) = guard.take() {
            let _ = server.child.kill();
        }
    }
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), tauri::Error> {
    let open = MenuItem::with_id(app, "open", "打开窗口", true, None::<&str>)?;
    let restart = MenuItem::with_id(app, "restart", "重启本地服务", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &restart, &quit])?;

    TrayIconBuilder::new()
        .tooltip("a2api")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "restart" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = restart_desktop_server(&handle).await {
                        eprintln!("[a2api-desktop] 重启本地服务失败: {error}");
                    }
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;
    Ok(())
}

fn open_main_window(app: &tauri::AppHandle, raw_url: &str) -> Result<(), String> {
    let url = Url::parse(raw_url).map_err(|error| format!("桌面窗口地址无效: {error}"))?;
    if let Some(window) = app.get_webview_window("main") {
        window
            .navigate(url)
            .map_err(|error| format!("无法切换窗口地址: {error}"))?;
        window.show().map_err(|error| format!("无法显示窗口: {error}"))?;
        window.set_focus().map_err(|error| format!("无法聚焦窗口: {error}"))?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("a2api")
        .inner_size(1280.0, 820.0)
        .min_inner_size(960.0, 640.0)
        .build()
        .map_err(|error| format!("无法创建窗口: {error}"))?;
    Ok(())
}

async fn wait_for_health(url: &str, timeout: Duration) -> Result<(), String> {
    let started = Instant::now();
    while started.elapsed() <= timeout {
        if check_health(url).is_ok() {
            return Ok(());
        }
        tauri::async_runtime::sleep(Duration::from_millis(250)).await;
    }
    Err("等待本地服务启动超时".to_string())
}

fn check_health(url: &str) -> Result<(), String> {
    let parsed = Url::parse(url).map_err(|error| format!("健康检查地址无效: {error}"))?;
    let host = parsed.host_str().ok_or_else(|| "健康检查缺少 host".to_string())?;
    let port = parsed.port().ok_or_else(|| "健康检查缺少 port".to_string())?;
    let path = parsed.path();
    let mut stream = TcpStream::connect((host, port)).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|error| error.to_string())?;
    if response.starts_with("HTTP/1.1 200") || response.starts_with("HTTP/1.0 200") {
        return Ok(());
    }
    Err("健康检查未返回 200".to_string())
}

fn find_available_port(preferred: u16) -> Result<u16, String> {
    for offset in 0..200u16 {
        let port = preferred.saturating_add(offset);
        if port == 0 {
            continue;
        }
        if TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Ok(port);
        }
    }
    Err("未找到可用的本地端口".to_string())
}

fn resolve_preferred_port() -> u16 {
    std::env::var("A2API_DESKTOP_SERVER_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(4000)
}

fn desktop_config_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法读取应用配置目录: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建应用配置目录: {error}"))?;
    Ok(dir)
}

fn load_or_create_tokens(config_dir: &Path) -> Result<DesktopTokens, String> {
    let path = config_dir.join("desktop.env");
    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|error| format!("无法读取桌面配置: {error}"))?;
        let auth_token = read_env_value(&content, "AUTH_TOKEN");
        let proxy_token = read_env_value(&content, "PROXY_TOKEN");
        if let (Some(auth_token), Some(proxy_token)) = (auth_token, proxy_token) {
            return Ok(DesktopTokens {
                auth_token,
                proxy_token,
            });
        }
    }

    let tokens = DesktopTokens {
        auth_token: format!("a2api-admin-{}", Uuid::new_v4()),
        proxy_token: format!("a2api-proxy-{}", Uuid::new_v4()),
    };
    let content = format!("AUTH_TOKEN={}\nPROXY_TOKEN={}\n", tokens.auth_token, tokens.proxy_token);
    fs::write(&path, content).map_err(|error| format!("无法写入桌面配置: {error}"))?;
    Ok(tokens)
}

fn read_env_value(content: &str, key: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (raw_key, raw_value) = line.split_once('=')?;
        if raw_key.trim() == key {
            Some(raw_value.trim().to_string())
        } else {
            None
        }
    })
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(|value| value.to_string())
        .ok_or_else(|| format!("路径不是有效 UTF-8: {}", path.display()))
}
