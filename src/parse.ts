// Shared variables used during parsing

// List of active groupings: either variant ('xxx:') or prefix
const groupings: string[] = []

// List of parsed rules
export interface ParsedRule {
  token: string

  /** [":sm", ":dark", ":hover"] */
  variants: string[]

  prefix: string

  /** "text-sm", "rotate-45" */
  directive: string

  rule: string

  tokenStartOffset: number
}

const startGrouping = (value = ''): '' => {
  groupings.push(value)
  return ''
}

const endGrouping = (isWhitespace?: boolean): void => {
  // If isWhitespace is true
  // ['', ':sm', ':hover'] => ['']
  // ['', ':sm', ':hover', ''] => ['', ':sm', ':hover']

  // If isWhitespace is falsey
  // ['', ':sm', ':hover'] => ['']
  // ['', ':sm', ':hover', ''] => ['', ':sm', ':hover', '']

  const index = groupings.lastIndexOf('')

  if (~index) {
    groupings.splice(
      index + ~~(isWhitespace as boolean),
      groupings.length - index + ~~(isWhitespace as boolean),
    )
  }
}

const onlyPrefixes = (s: string): '' | boolean => s && s[0] !== ':'
const onlyVariants = (s: string): '' | boolean => s[0] === ':'

export const parse = (text: string, offset = text.length): ParsedRule => {
  groupings.length = 0

  let char: string
  let token = ''
  let tokenStartOffset = 0

  for (let position = 0; position < offset; position++) {
    switch ((char = text[position])) {
      case ':':
        if (token) {
          tokenStartOffset = offset
          token = startGrouping(':' + token)
        }

        break

      case '(':
        // If there is a token this is the prefix for all grouped tokens
        if (token) {
          tokenStartOffset = offset
          token = startGrouping(token)
        }

        startGrouping()

        break

      case ')':
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        tokenStartOffset = offset
        token = ''
        endGrouping(char !== ')')

        break

      default:
        token += char
    }
  }

  const variants = groupings.filter(onlyVariants)
  const prefix = groupings.filter(onlyPrefixes).join('-')
  const directive = token === '&' ? token : (prefix && prefix + '-') + token

  if (token === '&') {
    tokenStartOffset += 1
  }

  return {
    token,
    variants,
    prefix,
    directive,
    rule: (variants.length === 0 ? '' : variants.join('').slice(1) + ':') + directive,
    tokenStartOffset,
  }
}
