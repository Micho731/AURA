/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Inter', 'sans-serif'],
      },
      colors: {
        aura: {
          cyan: '#7CE7FF',     // softer, less harsh than #00f5ff
          deep: '#0A1628',     // FOE navy
          ink:  '#050810',
        },
      },
      animation: {
        'breath': 'breath 4s ease-in-out infinite',
        'slow-spin': 'spin 30s linear infinite',
        'ping-slow': 'ping-slow 2s cubic-bezier(0,0,0.2,1) infinite',
      },
      keyframes: {
        breath: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.9' },
          '50%':      { transform: 'scale(1.03)', opacity: '1' },
        },
        'ping-slow': {
          '0%':   { transform: 'scale(1)', opacity: '0.5' },
          '75%, 100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
}
