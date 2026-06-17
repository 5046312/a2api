<script setup lang="ts">
const version = '0.1.0';

const highlights = [
  { title: '统一代理入口', desc: '兼容 OpenAI、Claude Messages、Gemini 和多类 OpenAI-compatible 扩展接口。' },
  { title: '模型路由', desc: '按模型、上游地址、账号、内部凭据和下游 Key 策略选择可用通道。' },
  { title: '管理后台', desc: '覆盖账号、路由、下游 Key、日志、事件、通知、导入导出和模型测试。' },
  { title: '轻量部署', desc: 'Fastify + SQLite + Vite Vue，当前以 Docker Compose 和本地服务模式为主。' }
];

const stack = [
  { name: '后端', desc: 'Fastify 5 / TypeScript strict / Drizzle ORM' },
  { name: '数据库', desc: 'SQLite / better-sqlite3 / 启动迁移' },
  { name: '前端', desc: 'Vite / Vue 3 / Naive UI / TailwindCSS / SCSS' },
  { name: '代理', desc: 'undici / 流式转发 / debug trace' }
];

const deferred = [
  'K3s / Helm 更新中心',
  'MySQL / PostgreSQL 运行库',
  'Tauri 桌面壳',
  '多节点部署'
];
</script>

<template>
  <section class="page-stack">
    <n-card class="admin-card" :bordered="false">
      <div class="panel-header">
        <div>
          <h2>关于 a2api</h2>
          <p class="muted">AI API 聚合代理，面向多上游、多账号和多协议转发。</p>
        </div>
        <n-tag type="success" size="small">v{{ version }}</n-tag>
      </div>
      <div class="stats-grid">
        <div v-for="item in highlights" :key="item.title" class="stat-card">
          <strong class="stat-value">{{ item.title }}</strong>
          <div class="muted">{{ item.desc }}</div>
        </div>
      </div>
    </n-card>

    <div class="two-column">
      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>技术栈</h2>
            <p class="muted">当前实现使用全 TypeScript strict。</p>
          </div>
        </div>
        <div class="table-wrap">
          <n-table size="small" :bordered="false" single-line class="admin-table">
            <thead>
              <tr>
                <th>模块</th>
                <th>实现</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in stack" :key="item.name">
                <td>{{ item.name }}</td>
                <td>{{ item.desc }}</td>
              </tr>
            </tbody>
          </n-table>
        </div>
      </n-card>

      <n-card class="admin-card" :bordered="false">
        <div class="panel-header">
          <div>
            <h2>后置能力</h2>
            <p class="muted">不影响当前代理闭环的部署和运维增强。</p>
          </div>
        </div>
        <div class="table-wrap">
          <n-table size="small" :bordered="false" single-line class="admin-table">
            <thead>
              <tr>
                <th>能力</th>
                <th>阶段</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in deferred" :key="item">
                <td>{{ item }}</td>
                <td><n-tag type="error" size="small">P3</n-tag></td>
              </tr>
            </tbody>
          </n-table>
        </div>
      </n-card>
    </div>
  </section>
</template>
