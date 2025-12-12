/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'whatsapp-green': '#25D366',
        'whatsapp-teal': '#075E54',
        'whatsapp-light': '#128C7E',
        'whatsapp-blue': '#34B7F1',
      },
    },
  },
  plugins: [],
}




