export interface Rule {
  /**
   * The string indictated by loc
   */
  raw: string

  /**
   * The rule with all variants
   */
  value: string

  /**
   * The utility name including `-` if it is negated.
   */
  name: string

  /**
   * If this utility is within a prefix group the aggreated prefix.
   */
  prefix: string

  /**
   * Is the rule negated like `-mx`
   */
  negated: boolean

  /**
   * Something like `underline!` or `bg-red-500!` or `red-500!`
   */
  important: boolean

  variants: RuleVariant[]

  loc: TextRange
  spans: TextRange[]
}

export interface RuleVariant {
  /**
   * The string indictated by loc
   */
  raw: string

  /**
   * The value like: `hover:` or `after::`
   */
  value: string

  /**
   * Name without last colon like: `hover` or `after:`
   */
  name: string

  loc: TextRange
}

export function parse(input: string, position?: number): Rule[]
export function parse(input: string, position: number, exact: boolean): Rule

export function parse(input: string, position?: number, exact?: boolean): Rule[] | Rule {
  const root = astish(input, exact ? position : undefined)

  if (exact) {
    let node: Exclude<Node, null> = root

    while (node.next) {
      node = node.next
    }

    return toRule(
      node.kind === NodeKind.Identifier ? node : createIdentifier(node, node, '', node.loc.end),
    )
  }

  const rules: Rule[] = []

  for (let node: Node | null = root; (node = node.next); ) {
    if (node.kind === NodeKind.Identifier && node.terminator) {
      rules.push(toRule(node))
    }
  }

  if (position != null) {
    const rulesAtPosition = rules.filter((rule) =>
      rule.spans.some((loc) => loc.start <= position && position < loc.end),
    )

    if (rulesAtPosition.length) {
      return rulesAtPosition
    }

    // Find closest group for position and check rules
    let group = root.loc

    for (let node: Node = root; node; node = node.next) {
      if (
        node.kind === NodeKind.Group &&
        node.loc.start <= position &&
        position < node.loc.end &&
        (group.start < node.loc.start || node.loc.start < group.end)
      ) {
        group = node.loc
      }
    }

    return rules.filter((rule) =>
      rule.spans.some((loc) => group.start <= loc.start && loc.end <= group.end),
    )
  }
  return rules
}

function toRuleVariant(node: Variant): RuleVariant {
  return { raw: node.raw, value: node.value, name: node.name, loc: node.loc }
}

function toRule(identifier: Identifier): Rule {
  const rule: Rule = {
    raw: identifier.raw,
    value: '',
    name: '',
    prefix: '',
    important: false,
    negated: false,
    loc: identifier.loc,
    spans: [],
    variants: [],
  }

  const names = []

  for (let node: Node | null = identifier; node; node = node.parent) {
    // join consecutive spans
    const loc = { ...node.loc }
    if (node.kind !== NodeKind.Group) {
      const firstSpan = rule.spans[0]
      if (firstSpan?.start === loc.end) {
        firstSpan.start = loc.start
      } else {
        rule.spans.unshift(loc)
      }
    }

    if (node.kind === NodeKind.Identifier) {
      rule.important = rule.important || node.important
      rule.negated = rule.negated || node.negated
      names.unshift(node.name)
    } else if (node.kind === NodeKind.Variant) {
      rule.variants.unshift(toRuleVariant(node))
    }
  }

  rule.name =
    (rule.negated ? '-' : '') +
    names.reduce(
      (name, part) => (part === '&' ? name : name && part ? `${name}-${part}` : name || part),
      '',
    )

  rule.prefix = names
    .slice(0, -1)
    .reduce(
      (name, part) => (part === '&' ? name : name && part ? `${name}-${part}` : name || part),
      '',
    )

  if (rule.prefix && rule.negated) {
    rule.prefix = '-' + rule.prefix
  }

  rule.value =
    rule.variants.map((variant) => variant.value).join('') + (rule.important ? '!' : '') + rule.name

  return rule
}

export interface TextRange {
  start: number
  end: number
}

export const enum NodeKind {
  Group = 1,
  Identifier = 2,
  Variant = 3,
}

export type Node = Variant | Identifier | Group | null

/**
 * `text(lg sm:base) hover:underline`
 *
 * text -> identifier: prev: null, next: group, parent: root
 * group -> group: prev: text, next: lg, parent: text
 * lg -> identifier: prev: text, next: sm, parent: group, end: true
 * whitespace -> parent = node.parent.kind = 'Group' -> parent = group
 * sm -> variant: prev: lg, next: base, parent: group
 * base -> identifier: prev: sm, next: hover, parent: sm, end: true
 * ) -> whitespace -> parent = group -> parent.parent.kind = 'Group' -> parent = root
 * hover -> variant: prev: base, next: underline, parent: root
 * underline -> variant: prev: hover, next: null, parent: hover, end: true
 */
export interface BaseNode {
  /** Points to previous node */
  prev: Node

  /** Points to next node */
  next: Node

  /** Points to parent node */
  parent: Node

  loc: TextRange
}

export interface Identifier extends BaseNode {
  kind: NodeKind.Identifier
  raw: string
  name: string

  terminator: boolean

  /**
   * Something like `-mx`
   */
  negated: boolean

  /**
   * Something like `underline!` or `bg-red-500!` or `red-500!`
   */
  important: boolean
}

/**
 * Something like `hover:` or `after::`
 */
export interface Variant extends BaseNode {
  kind: NodeKind.Variant

  /**
   * Raw value like: `hover:` or `after::`
   */
  raw: string

  /**
   * The value like: `hover:` or `after::`
   */
  value: string

  /**
   * Name without last colon like: `hover` or `after:`
   */
  name: string
}

/**
 * `(text-bold)` or `(bold underline)`
 */
export interface Group extends BaseNode {
  kind: NodeKind.Group
  // body: (Variant | Identifier | Group)[]
}

export function astish(text: string, atPosition = Infinity): Group {
  let buffer = ''
  let start = 0

  const root: Group = {
    kind: NodeKind.Group,

    prev: null,
    next: null,
    parent: null,

    loc: { start, end: text.length },
  }

  let parent: Exclude<Node, null> = root
  let node: Exclude<Node, null> = root

  for (let char: string, inArbitrary = false, position = 0; (char = text[position]); position++) {
    if (position >= atPosition) {
      node.next = createIdentifier(node, parent, buffer, start)

      return root
    }

    if ((inArbitrary && !/\s/.test(char)) || char == '[') {
      buffer += char
      inArbitrary = char != ']'
      continue
    }

    switch (char) {
      case ':':
        if (buffer) {
          buffer += char

          if (text[position + 1] == ':') {
            buffer += text[position++]
          }

          parent = node = node.next = createVariant(node, parent, buffer, start)

          buffer = ''
          start = position + 1
        } else {
          // Invalid
        }

        break

      case '(': {
        // If there is a token this is the prefix for all grouped tokens
        if (buffer) {
          parent = node = node.next = createIdentifier(node, parent, buffer, start)
        }

        parent = node = node.next = createGroup(node, parent, position)

        buffer = ''
        start = position + 1

        break
      }

      case ')':
      case ' ':
      case '\t':
      case '\n':
      case '\r':
        if (buffer || node.kind == NodeKind.Variant) {
          parent = node = node.next = createIdentifier(
            node,
            parent,
            buffer,
            start,
            /* terminator */ true,
          )
        }

        parent = getParentGroup(parent) || root

        if (char == ')') {
          parent.loc.end = position + 1
          parent = parent.parent || root
        }

        buffer = ''
        start = position + 1

        break

      default:
        buffer += char
    }
  }

  // Consume remaining buffer or completion triggered at the end
  if (buffer || node.kind == NodeKind.Variant || atPosition === text.length) {
    node.next = createIdentifier(node, parent, buffer, start, true)
  }

  return root
}

function getParentGroup(node: Node): Group | null {
  while (node && node.kind != NodeKind.Group) {
    node = node.parent
  }

  return node
}

function createGroup(node: Node, parent: Node, position: number): Group {
  return {
    kind: NodeKind.Group,
    prev: node,
    next: null,
    parent,
    loc: {
      start: position,
      end: position + 1,
    },
  }
}

function createVariant(
  node: Exclude<Node, null>,
  parent: Node,
  raw: string,
  start: number,
): Variant {
  if (raw[0] == '!') {
    raw = raw.slice(1)
    parent = node = node.next = createIdentifier(node, parent, '!', start)
    start += 1
  }

  return {
    kind: NodeKind.Variant,

    prev: node,
    next: null,
    parent,

    /**
     * Raw value like: `hover:` or `after::`
     */
    raw,

    value: raw,

    /**
     * Name without last colon like: `hover` or `after:`
     */
    name: raw.slice(0, -1),

    // isPseudoElement: raw.endsWith('::'),

    loc: {
      start,
      end: start + raw.length,
    },
  }
}

function createIdentifier(
  node: Node,
  parent: Node,
  raw: string,
  start: number,
  terminator = false,
): Identifier {
  let name = raw
  let negated = false
  let important = false

  if (name[0] == '!') {
    name = name.slice(1)
    important = true
  } else if (name[name.length - 1] == '!') {
    name = name.slice(0, -1)
    important = true
  }

  if (name[0] == '-') {
    name = name.slice(1)
    negated = true
  }

  return {
    kind: NodeKind.Identifier,
    prev: node,
    next: null,
    parent,
    raw,
    name,
    terminator,
    negated,
    important,
    loc: {
      start,
      end: start + raw.length,
    },
  }
}
