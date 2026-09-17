[TOC]

Keep an inline [TOC] reference visible.

:::info[Background]
An informational callout.
:::

:::success
A successful result.
:::

:::warning
Something needs attention.
:::

:::danger
Something can cause damage.
:::

:::spoiler[Show the answer]
The answer is 42.
:::

:::spoiler Terminal output

The command returned **successfully**.

:::

:::spoiler {state="open" class="ignored"} Open details

This starts expanded.

:::

:::custom[Custom heading]
Unknown directives keep their content.
:::

> [!NOTE] A custom note
> Notes can contain **Markdown**.

> [!TIP]
> A useful suggestion.

> [!IMPORTANT]
> Essential context.

> [!WARNING]
> A GitHub warning.

> [!CAUTION]
> A risky operation.

> A regular blockquote stays a blockquote.

Term
: A concise definition.

Emoji aliases become :sparkles: and inline math becomes $E = mc^2$.

This is ==important==, ++new++, H~2~O, x^2^, and {漢字|かんじ}.

- [x] Published
- [ ] Shared

A statement with a footnote.[^compatibility]

<script>alert('unsafe')</script>

[Unsafe link](javascript:alert('unsafe'))

[^compatibility]: Footnotes stay close to their source.

$$
c = \pm\sqrt{a^2 + b^2}
$$

Malformed math stays readable: $\broken{$.

```javascript=101
const answer = 42;
:::warning
```

```javascript=
const first = 1;
const second = 2;
```

```javascript=+
const third = 3;
```

```!
A very long plaintext line should wrap instead of forcing horizontal scrolling.
```

```typescript=10 [10,12]
const first = 1;
const second = 2;
const third = 3;
```
