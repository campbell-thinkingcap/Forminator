import '../src/index.css';

export const globalTypes = {
  theme: {
    name: 'Theme',
    description: 'Global theme',
    defaultValue: 'dark',
    toolbar: {
      icon: 'paintbrush',
      items: [
        { value: 'dark', title: 'Dark' },
        { value: 'light', title: 'Light' },
        { value: 'thinkingcap', title: 'ThinkingCap' },
      ],
      showName: true,
    },
  },
};

export const decorators = [
  (Story, context) => {
    document.documentElement.setAttribute('data-theme', context.globals.theme ?? 'dark');
    return Story();
  },
];

/** @type { import('@storybook/react-vite').Preview } */
const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: {
      test: "todo"
    }
  },
};

export default preview;