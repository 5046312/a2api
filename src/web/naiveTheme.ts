import type { GlobalThemeOverrides } from 'naive-ui';

export const naiveThemeOverrides: GlobalThemeOverrides = {
  common: {
    fontFamily: 'Lato, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontFamilyMono: '"Fira Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    primaryColor: '#176b87',
    primaryColorHover: '#1f7f9f',
    primaryColorPressed: '#145972',
    primaryColorSuppl: '#1f7f9f',
    borderRadius: '8px',
    borderColor: '#d6dde8',
    dividerColor: '#e6ebf2',
    textColorBase: '#172033',
    textColor1: '#172033',
    textColor2: '#38465a',
    textColor3: '#65748b',
    bodyColor: '#eef2f7',
    tableColor: '#ffffff',
    cardColor: '#ffffff',
    modalColor: '#ffffff',
    popoverColor: '#ffffff'
  },
  Button: {
    heightMedium: '36px',
    borderRadiusMedium: '8px',
    fontWeight: '700',
    paddingMedium: '0 14px'
  },
  Card: {
    borderRadius: '8px',
    paddingMedium: '18px',
    titleFontSizeMedium: '18px'
  },
  DataTable: {
    thColor: '#f8fafc',
    thTextColor: '#65748b',
    tdColor: '#ffffff',
    tdColorHover: '#f4f9fc',
    borderColor: '#e6ebf2',
    fontSizeMedium: '13px',
    thPaddingMedium: '9px 10px',
    tdPaddingMedium: '10px'
  },
  Table: {
    thColor: '#f8fafc',
    thTextColor: '#65748b',
    tdColor: '#ffffff',
    tdColorHover: '#f4f9fc',
    borderColor: '#e6ebf2',
    fontSizeMedium: '13px',
    thPaddingMedium: '9px 10px',
    tdPaddingMedium: '10px'
  },
  Input: {
    heightMedium: '36px',
    borderRadius: '8px'
  },
  Select: {
    peers: {
      InternalSelection: {
        heightMedium: '36px',
        borderRadius: '8px'
      }
    }
  },
  Tag: {
    borderRadius: '6px',
    fontWeightStrong: '700'
  }
};
