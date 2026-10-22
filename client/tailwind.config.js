/** @type {import('tailwindcss').Config} */
export default {
  content: { relative: true, files: ['./index.html', './src/**/*.{ts,tsx}'] },
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Helvetica Neue', 'Helvetica', 'Arial', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'] },
      borderRadius: { DEFAULT: '2px', md: '2px', lg: '3px', xl: '3px', '2xl': '4px' },
      colors: {
        zinc: { 50: '#171914', 100: '#20221e', 200: '#292b26', 300: '#3b3d36', 400: '#565851', 500: '#62645c', 600: '#85877e', 700: '#d6d7cd', 800: '#e5e5dc', 900: '#fcfbf8', 950: '#f6f5f0' },
        amber: { 200: '#80291e', 300: '#9f2e21', 400: '#ba3526', 500: '#ba3526', 600: '#a32f22', 700: '#8b2b20', 900: '#edc2b8', 950: '#f5e5df' },
        emerald: { 200: '#254332', 300: '#2d563f', 400: '#38604b', 500: '#38604b', 600: '#305a43', 700: '#264936', 900: '#c8dccf', 950: '#e0ebe2' },
        red: { 200: '#80271f', 300: '#992f25', 400: '#b3261e', 500: '#b3261e', 600: '#9b241e', 900: '#edc8c1', 950: '#f9e1dd' },
        sky: { 200: '#244b65', 300: '#285775', 400: '#306785', 900: '#c4dae6', 950: '#e4eef3' },
        violet: { 300: '#625071', 500: '#715780', 700: '#b8a8c0', 800: '#d0c4d5', 950: '#eee8f1' },
        orange: { 300: '#935024', 500: '#a85a24' },
        blue: { 300: '#285775', 400: '#306785', 500: '#306785', 600: '#285775' },
      },
    },
  },
  plugins: [],
};
