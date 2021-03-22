<div align="center">

# @twind/typescript-plugin

TypeScript language service plugin that adds IntelliSense for [Twind](https://twind.dev)

[![MIT License](https://flat.badgen.net/github/license/tw-in-js/typescript-plugin)](https://github.com/tw-in-js/typescript-plugin/blob/main/LICENSE)
[![Latest Release](https://flat.badgen.net/npm/v/@twind/typescript-plugin?icon=npm&label)](https://www.npmjs.com/package/@twind/typescript-plugin)
[![Github](https://flat.badgen.net/badge/icon/tw-in-js%2Ftypescript-plugin?icon=github&label)](https://github.com/tw-in-js/typescript-plugin)

![Demo](https://raw.githubusercontent.com/tw-in-js/typescript-plugin/main/assets/demo.gif)

---

If you are using VS Code as your editor – you can try our new _[Twind Intellisense for VS Code](https://github.com/tw-in-js/vscode-twind-intellisense)_ extension:

[Install via the Visual Studio Code Marketplace →](https://marketplace.visualstudio.com/items?itemName=sastan.twind-intellisense)

---

</div>

<!-- prettier-ignore-start -->
<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->


- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Contribute](#contribute)
- [License](#license)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->
<!-- prettier-ignore-end -->

## Features

- IntelliSense for [twind](https://github.com/tw-in-js/twind) variants and classes within
  - `tw` and `apply`
  - JSX attributes (`tw`, `class`, and `className`)
  - [style](https://twind.dev/docs/modules/twind_style.html) and `styled` (like [@twind/react](https://github.com/tw-in-js/twind-react/#readme) or [@twind/solid](https://github.com/tw-in-js/use-twind-with/tree/main/packages/solid#readme))
- Quick Info about
  - generated CSS
  - used theme value
  - the `px` value for `rem` values
- Color preview
- Support for grouping of variants and classes
- Warnings on
  - unknown classes
  - unknown theme values
  - unknown variants

## Installation

```sh
npm install --save-dev typescript @twind/typescript-plugin
```

## Usage

This plugin requires TypeScript 4.1 or later. It can provide intellisense in both JavaScript and TypeScript files within any editor that uses TypeScript to power their language features. This includes [VS Code](https://code.visualstudio.com), [Sublime with the TypeScript plugin](https://github.com/Microsoft/TypeScript-Sublime-Plugin), [Atom with the TypeScript plugin](https://atom.io/packages/atom-typescript), [Visual Studio](https://www.visualstudio.com), and others.

If you have a custom twind configuration you need to extract that into an own file. Create a `twind.config.{ts,js,cjs,mjs}` in the root , `src`, `config`, or `public` folder. Then import it for use with setup. Here is example using a custom plugin:

```js
import { forms, formInput } from '@twind/forms'

/** @type {import('twind').Configuration} */
export default {
  plugins: { forms, 'form-input': formInput}
}

// Augment the twind module to add addtional completions
declare module 'twind' {
  interface Plugins {
    // forms should have been detected from setup – not need to add it
    // forms: ''

    // We want to add sm and lg modifiers to the form-input
    'form-input':
      | ''    // plain form-input
      | 'sm' // form-input-sm
      | 'lg' // form-input-lg
  }
}
```

> If no `twind.config.{ts,js,cjs,mjs}` exists and a `tailwind.config.{ts,js,cjs,mjs}` is found, the compatible values from the tailwind config will be used.

Add a `plugins` section to your [`tsconfig.json`](http://www.typescriptlang.org/docs/handbook/tsconfig-json.html) or [`jsconfig.json`](https://code.visualstudio.com/Docs/languages/javascript#_javascript-project-jsconfigjson)

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@twind/typescript-plugin"
      }
    ]
  }
}
```

See [Configuration](#configuration) below for details options.

### With VS Code

Currently you must manually install the plugin along side TypeScript in your workspace.

Finally, run the `Select TypeScript version` command in VS Code to switch to use the workspace version of TypeScript for VS Code's JavaScript and TypeScript language support. You can find more information about managing typescript versions [in the VS Code documentation](https://code.visualstudio.com/docs/typescript/typescript-compiling#_using-the-workspace-version-of-typescript).

By default VS Code will not trigger completions when editing "string" content, for example within JSX attribute values. Updating the `editor.quickSuggestions` setting may improve your experience, particularly when editing Tailwind classes within JSX:

```json
{
  "editor.suggest.showStatusBar": true,
  "editor.quickSuggestions": {
    "strings": true
  }
}
```

### With Sublime

This plugin works with the [Sublime TypeScript plugin](https://github.com/Microsoft/TypeScript-Sublime-Plugin).

And configure Sublime to use the workspace version of TypeScript by [setting the `typescript_tsdk`](https://github.com/Microsoft/TypeScript-Sublime-Plugin#note-using-different-versions-of-typescript) setting in Sublime:

```json
{
  "typescript_tsdk": "/path/to/the/project/node_modules/typescript/lib"
}
```

### With Atom

This plugin works with the [Atom TypeScript plugin](https://atom.io/packages/atom-typescript).

To get sytnax highlighting for styled strings in Atom, consider installing the [language-babel](https://atom.io/packages/language-babel) extension.

### With Visual Studio

This plugin works [Visual Studio 2017](https://www.visualstudio.com) using the TypeScript 2.5+ SDK.

Then reload your project to make sure the plugin has been loaded properly. Note that `jsconfig.json` projects are currently not supported in VS.

## Configuration

### Tags

This plugin adds IntelliSense to any template literal [tagged](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals) with `tw` or `apply`:

```js
import { tw } from 'twind'

tw`
  sm:hover:(
    bg-black
    text-white
  )
  md:(bg-white hover:text-black)
`
```

You can enable IntelliSense for other tag names by configuring `"tags"`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@twind/typescript-plugin",
        "tags": ["tw", "cx"]
      }
    ]
  }
}
```

Now strings tagged with either `tw` and `cx` will have IntelliSense.

### Attributes

This plugin adds IntelliSense to JSX `tw`, `class`, and `className` attributes:

```js
<span
  className="text-purple-400"
  tw={`
    sm:hover:(
      bg-black
      text-white
    )
    md:(bg-white hover:text-black)
  `}
>...</span>
`
```

You can enable IntelliSense for other attributes by configuring `"attributes"`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@twind/typescript-plugin",
        "attributes": ["tw"]
      }
    ]
  }
}
```

Now only the `tw` attribute will have IntelliSense.

### Styles

This plugin adds IntelliSense to [style](https://twind.dev/docs/modules/twind_style.html) and `styled` (like [@twind/react](https://github.com/tw-in-js/twind-react/#readme) or [@twind/solid](https://github.com/tw-in-js/use-twind-with/tree/main/packages/solid#readme))

```js
// Same for style({... })
const Button = styled("button", {
  base: `
    appearance-none border-none bg-transparent
    rounded-full px-2.5
  `,

  variants: {
    variant: {
      gray: `
        bg-gray-500
        hover:bg-gray-600
      `,
      primary: `
        text-white bg-purple-500
        hover:bg-purple-600
      `,
    },

    outlined: {
      true: `bg-transparent ring-1`,
    },
  },

  matches: [
    {
      variant: "gray",
      outlined: true,
      use: `ring-gray-500`,
    },
  }
})
```

You can enable IntelliSense for other `style` like functions by configuring `"styles"`:

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@twind/typescript-plugin",
        "styles": ["styled", "stitched"]
      }
    ]
  }
}
```

Now the `styled` and `stitched` functions will have IntelliSense.

### Debug

Allows to enabling/disabling additional debug information shown in hover and completion popups (default: `false`).

```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "@twind/typescript-plugin",
        "debug": true
      }
    ]
  }
}
```

Now the debug information is shown.

## Contribute

Thanks for being willing to contribute!

> This project is free and open-source, so if you think this project can help you or anyone else, you may [star it on GitHub](https://github.com/tw-in-js/typescript-plugin). Feel free to [open an issue](https://github.com/tw-in-js/typescript-plugin/issues) if you have any idea, question, or you've found a bug.

**Working on your first Pull Request?** You can learn how from this _free_ series [How to Contribute to an Open Source Project on GitHub](https://egghead.io/series/how-to-contribute-to-an-open-source-project-on-github)

We are following the [Conventional Commits](https://www.conventionalcommits.org) convention.

### Develop

> Ensure you run at least Node v14.

Clone the repository and cd into the project directory.

Run `yarn install && yarn build`.

- `yarn test`: Run test suite including linting
- `yarn format`: Ensure consistent code style
- `yarn build`: Build the package
- `yarn release`: To publish the package

### Manual testing the Language service plugin

You can check manually language service plugin features with our example project.

```
yarn build
cd dist
yarn link
cd project-fixtures/react-apollo-prj
yarn install
yarn link @twind/typescript-plugin
code . # Or launch editor/IDE what you like
```

Of course, you can use other editor which communicates with tsserver.

> To see typescript debug logs start your editor with `TSS_LOG="-logToFile true -file /path/to/tss.log -level verbose"`.

## License

[MIT](https://github.com/tw-in-js/typescript-plugin/blob/main/LICENSE)
