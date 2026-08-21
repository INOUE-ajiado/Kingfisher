/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class', // クラスベースのダークモード切替を有効化
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        kingfisher: {
          blue: {
            vibrant: '#2563EB',
            jade: '#38B48B',
            peacock: '#009E9F',
          },
          orange: {
            vibrant: '#F97316',
            ochre: '#D97706',
          },
        },
      },
    },
  },
  plugins: [],
}
