import { fixturePreset } from './config.ts'
import { mergeConfigs } from '@bamboocss/config'
import { defineConfig } from '@bamboocss/dev'
import { parseJson, stringifyJson } from '@bamboocss/shared'
import type { LoadConfigResult, UserConfig } from '@bamboocss/types'

const sandboxConfig = defineConfig({
  exclude: [],
  global: {
    css: {
      '*': {
        fontFamily: 'Inter',
        margin: '0',
      },
      a: {
        color: 'inherit',
        textDecoration: 'none',
      },
    },
  },
  include: ['./src/**/*.{tsx,jsx}', './pages/**/*.{jsx,tsx}'],
  outdir: 'styled-system',
  preflight: true,
  theme: {
    extend: {
      recipes: {
        button: {
          base: {
            fontSize: 'lg',
          },
          className: 'button',
          compoundVariants: [
            {
              css: {
                fontSize: '12px',
              },
              size: 'sm',
              variant: 'primary',
            },
            {
              css: {
                fontSize: '24px',
                fontWeight: 'bold',
                padding: 4,
              },
              state: 'focused',
              variant: ['primary', 'danger'],
            },
          ],
          description: 'A button styles',
          jsx: ['Button', 'ListedButton', /WithRegex$/, 'PrimaryButtonLike'],
          variants: {
            rounded: {
              true: {
                borderRadius: 'md',
              },
            },
            size: {
              md: {
                borderRadius: 'md',
                padding: '4',
              },
              sm: {
                borderRadius: 'sm',
                padding: '2',
              },
            },
            state: {
              focused: {
                color: 'green',
              },
              hovered: {
                color: 'pink.400',
              },
            },
            variant: {
              danger: {
                backgroundColor: 'red.500',
                color: 'white',
              },
              primary: {
                backgroundColor: 'blue.500',
                color: 'white',
              },
              purple: {
                backgroundColor: 'purple.500',
                color: 'amber.300',
              },
              secondary: {
                backgroundColor: 'green.500',
                color: 'pink.300',
              },
            },
          },
        },
      },
      semanticTokens: {
        colors: {
          bg: {
            value: { _osDark: 'token(colors.gray.400)', base: 'token(colors.gray.600)' },
          },
          text: {
            value: { _osDark: 'token(colors.gray.400)', base: 'token(colors.gray.600)' },
          },
        },
      },
      tokens: {
        colors: {
          red: {
            '400': {
              deprecated: true,
              description: 'red color',
              value: '#ff0000',
            },
          },
        },
      },
    },
  },
})

const config: UserConfig = {
  ...fixturePreset,
  cssVarRoot: ':where(html)',
  cwd: '',
  include: [],
  outdir: 'styled-system',
}

const fixtureDefaults = {
  config,
  dependencies: [],
  deserialize: () => parseJson(stringifyJson(config)),
  hooks: {},
  path: '',
  serialized: stringifyJson(config),
} as LoadConfigResult

const resolveConfig = (userConfig?: Record<string, unknown>) =>
  mergeConfigs([
    fixtureDefaults.config,
    sandboxConfig,
    { importMap: './bamboo' },
    ...(userConfig ? [userConfig] : []),
  ] as unknown as Parameters<typeof mergeConfigs>[0]) as unknown as UserConfig

/** The context the rules read, over the fixture config, as `@bamboocss/node` prepares it. */
export const createContext = async (userConfig?: Record<string, unknown>) => {
  const { BambooContext } = await import('@bamboocss/node')
  return new BambooContext({
    ...fixtureDefaults,
    // Where the linted files are, as a real config's directory is: `outdir` and `include` are read
    // from it.
    config: { ...resolveConfig(userConfig), cwd: process.cwd() },
    // A rewrite the build reads in place of the file, as it reads a `.vue` file's script.
    hooks: {
      'parser:before': ({ content, filePath }: { content: string; filePath: string }) =>
        filePath.endsWith('.rewritten.ts') ? `// rewritten\n${content}` : undefined,
    },
  })
}
