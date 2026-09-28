/** @type {import('tailwindcss').Config} */
const color = (name) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: color('background'),
        foreground: color('foreground'),
        sidebar: color('sidebar'),
        card: color('card'),
        elevated: color('elevated'),
        primary: color('primary'),
        'primary-foreground': color('primary-foreground'),
        muted: color('muted'),
        border: color('border'),
        danger: color('danger'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', '"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
        '2xl': 'calc(var(--radius) + 8px)',
      },
      boxShadow: {
        artwork: '0 24px 48px -16px rgb(0 0 0 / 0.65), 0 8px 16px -8px rgb(0 0 0 / 0.4)',
        popover: '0 16px 40px -8px rgb(0 0 0 / 0.6), 0 0 0 1px hsl(var(--border))',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        equalize: {
          '0%, 100%': { transform: 'scaleY(0.3)' },
          '50%': { transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 250ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        equalize: 'equalize 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
