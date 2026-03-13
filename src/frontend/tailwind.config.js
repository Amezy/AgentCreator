/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // M3 Primary (Blue)
        'primary': '#1565C0',
        'on-primary': '#FFFFFF',
        'primary-container': '#D4E4FF',
        'on-primary-container': '#001C3A',

        // M3 Secondary
        'secondary': '#545F71',
        'on-secondary': '#FFFFFF',
        'secondary-container': '#D8E3F8',
        'on-secondary-container': '#111C2B',

        // M3 Tertiary
        'tertiary': '#6E5676',
        'on-tertiary': '#FFFFFF',
        'tertiary-container': '#F7D8FF',
        'on-tertiary-container': '#271430',

        // M3 Error
        'error': '#BA1A1A',
        'on-error': '#FFFFFF',
        'error-container': '#FFDAD6',
        'on-error-container': '#410002',

        // M3 Surface
        'surface': '#FAFCFF',
        'on-surface': '#1A1C1E',
        'surface-variant': '#DFE3EB',
        'on-surface-variant': '#43474E',
        'surface-container-lowest': '#FFFFFF',
        'surface-container-low': '#F4F6FA',
        'surface-container': '#EEF0F5',
        'surface-container-high': '#E8EAEF',
        'surface-container-highest': '#E2E4E9',

        // M3 Outline
        'outline': '#73777F',
        'outline-variant': '#C3C7CF',

        // M3 Inverse
        'inverse-surface': '#2F3133',
        'inverse-on-surface': '#F1F0F4',
        'inverse-primary': '#A5C8FF',

        // M3 Scrim & Shadow
        'scrim': '#000000',
        'shadow': '#000000',
      },
      fontFamily: {
        'roboto': ['Roboto', 'sans-serif'],
      },
      borderRadius: {
        'xs': '4px',
        'sm': '8px',
        'md': '12px',
        'lg': '16px',
        'xl': '28px',
      },
      boxShadow: {
        'elevation-1': '0px 1px 2px rgba(0, 0, 0, 0.3), 0px 1px 3px 1px rgba(0, 0, 0, 0.15)',
        'elevation-2': '0px 1px 2px rgba(0, 0, 0, 0.3), 0px 2px 6px 2px rgba(0, 0, 0, 0.15)',
        'elevation-3': '0px 4px 8px 3px rgba(0, 0, 0, 0.15), 0px 1px 3px rgba(0, 0, 0, 0.3)',
      },
    },
  },
  plugins: [],
};
