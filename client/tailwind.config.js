/** @type {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: ['./index.html', './src/**/*.{ts,tsx}'],
  },
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 国际主义（瑞士）设计系统：黑 / 白 / 红 + 灰阶。
        paper: '#F5F4F0', // 页面底：暖白纸面
        panel: '#FFFFFF', // 面板：纯白
        well: '#ECEAE2', // 悬停/内嵌浅灰
        ink: '#111110', // 墨黑
        muted: '#6E6C65', // 次要文字
        faint: '#A6A49B', // 最弱文字/占位
        line: '#DAD8CF', // 发丝线
        accent: '#E42313', // 瑞士红：强调、激活、DM、危险
      },
      fontFamily: {
        sans: [
          '"Helvetica Neue"',
          'Helvetica',
          'Arial',
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'sans-serif',
        ],
      },
      letterSpacing: {
        label: '0.18em',
      },
    },
  },
  plugins: [],
};
