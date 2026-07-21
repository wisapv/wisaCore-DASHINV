/** @type {import('tailwindcss').Config} */
export default {
  content: [
  "./index.html",
  "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#F5F6F8', // สีพื้นหลังเทาอ่อน (legacy, still used by Home/TemplateManager)
        primary: '#FF6A3D',    // สีส้ม (legacy)
        dark: '#1C1C1E',       // สีดำเข้ม (legacy)
        success: '#22C55E',    // สีเขียว
        danger: '#EF4444',     // สีแดง
        // New shared theme tokens (Detail/Overview design import)
        canvas: '#F3F2ED',
        ink: '#14140F',
        accent: '#D7FF3F',
        muted: '#9B9890',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        display: ['Space Grotesk', 'sans-serif'],
      },
      borderRadius: {
        '4xl': '26px',
        '5xl': '34px',
      }
    },
  },
  plugins: [],
}