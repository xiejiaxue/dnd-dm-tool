/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Helvetica Neue', 'Helvetica', 'Arial', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        display: ['Songti SC', 'STSong', 'Noto Serif SC', 'Source Han Serif SC', 'Noto Serif CJK SC', 'SimSun', 'Georgia', 'serif'],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '10px', xl: '14px', '2xl': '18px' },
      letterSpacing: { label: '0.18em' },
      colors: {
        paper: '#f4efe4', panel: '#fdfaf3', well: '#ece5d6', ink: '#1f1b17', muted: '#6b6257', faint: '#a79d8c', line: '#e0d6c3', accent: '#ad3328', gold: '#b08a3e', night: '#17151d',
        zinc: { 50: '#16130f', 100: '#1f1b17', 200: '#2a251f', 300: '#3c352d', 400: '#575046', 500: '#6b6257', 600: '#8c8272', 700: '#e0d6c3', 800: '#ebe3d2', 900: '#fdfaf3', 950: '#f4efe4' },
        amber: { 200: '#80291e', 300: '#9f2e21', 400: '#ba3526', 500: '#ba3526', 600: '#a32f22', 700: '#8b2b20', 900: '#edc2b8', 950: '#f5e5df' },
        emerald: { 200: '#254332', 300: '#2d563f', 400: '#38604b', 500: '#38604b', 600: '#305a43', 700: '#264936', 900: '#c8dccf', 950: '#e0ebe2' },
        red: { 200: '#80271f', 300: '#992f25', 400: '#b3261e', 500: '#b3261e', 600: '#9b241e', 900: '#edc8c1', 950: '#f9e1dd' },
        sky: { 200: '#244b65', 300: '#285775', 400: '#306785', 900: '#c4dae6', 950: '#e4eef3' },
        blue: { 300: '#285775', 400: '#306785', 500: '#306785', 600: '#285775' },
      },
    },
  },
  plugins: [],
};
