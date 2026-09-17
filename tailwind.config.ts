import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        black: '#000000',
        white: '#FFFFFF',
        gray: {
          50: '#FAFAFA',
          100: '#F5F5F7',
          200: '#E5E5EA',
          300: '#D4D4DD',
          400: '#A3A3B0',
          500: '#73737F',
          600: '#52525F',
          700: '#3F3F4A',
          800: '#26262D',
          900: '#17171A',
          950: '#0A0A0A',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Display"',
          '"SF Pro Text"',
          '"Helvetica Neue"',
          'Inter',
          'system-ui',
          'sans-serif',
        ],
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(18px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.98)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-12px)' },
        },
        shine: {
          '0%': { transform: 'translateX(-150%) skewX(-20deg)' },
          '100%': { transform: 'translateX(250%) skewX(-20deg)' },
        },
        drift: {
          '0%': { transform: 'translate(0, 0) scale(1)' },
          '33%': { transform: 'translate(36px, -24px) scale(1.05)' },
          '66%': { transform: 'translate(-24px, 24px) scale(0.97)' },
          '100%': { transform: 'translate(0, 0) scale(1)' },
        },
        'marquee-x': {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.9s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 1s ease both',
        'scale-in': 'scale-in 0.6s cubic-bezier(0.22, 1, 0.36, 1) both',
        float: 'float 6s ease-in-out infinite',
        shine: 'shine 1s ease-in-out',
        'drift-slow': 'drift 14s ease-in-out infinite',
        'marquee-x': 'marquee-x 45s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;