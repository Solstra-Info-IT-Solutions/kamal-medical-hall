# Layout rules (how screens are built so they never break on small phones)

React Native lays views out with flexbox. These rules use it the way Android's `ConstraintLayout` chains are used.

| ConstraintLayout idea | What we do in the app |
|---|---|
| A horizontal chain (icon, text, arrow) | `ListRow` in `components/layout.tsx`: leading and trailing views keep their size, the middle gets the rest |
| `0dp` / match-constraint text that wraps | the middle slot has `flex: 1` and `minWidth: 0`, so long text wraps instead of pushing its neighbours |
| `layout_constraintTop_toTopOf` | the leading view and the text start at the same top edge (`alignItems: 'flex-start'`) |
| Title with a badge pinned to the end | `TitleBadge`: badge on the right edge; if there is no room it moves to its own line, still on the right |
| Buttons side by side | `ButtonRow` (in `components/ui.tsx`): a cell is at least 136 px wide, two fit on a phone of 360 px or more, otherwise they stack |
| Same size everywhere | `Button` is always 52 high (40 when `small`), one line of text that shrinks a little instead of wrapping |

Do:
- Space things with `gap` and the `spacing` scale in `theme.ts`.
- Put a long text in a `flex: 1, minWidth: 0` container.
- Use `ButtonRow` whenever two or more buttons share a line.

Do not:
- Give a button a fixed width, or a different height from the others.
- Use a sibling's size to place something (margins that only work for one text length).
- Use `numberOfLines={1}` on names, titles or addresses (they may wrap to two lines).
