/**
 * The standard blue-circle Ethereum mark — the icon every wallet and
 * exchange uses for ETH, not the flat diamond outline. Kept separate from
 * Icon.tsx's glyph set because that set is single-path `currentColor`
 * shapes meant to inherit the surrounding text colour; this one is
 * intrinsically two-tone (brand blue + translucent white facets) and
 * would lose its identity if it were recoloured.
 */
export default function EthIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 32 32"
      className={`inline-block shrink-0 ${className}`}
    >
      <circle cx="16" cy="16" r="16" fill="#627EEA" />
      <g fill="#fff" fillRule="nonzero">
        <path fillOpacity=".602" d="M16.498 4v8.87l7.497 3.35z" />
        <path d="M16.498 4 9 16.22l7.498-3.35z" />
        <path fillOpacity=".602" d="M16.498 21.968v6.027L24 17.616z" />
        <path d="M16.498 27.995v-6.028L9 17.616z" />
        <path fillOpacity=".2" d="M16.498 20.573 24 16.22l-7.497-3.348z" />
        <path fillOpacity=".602" d="m9 16.22 7.498 4.353v-7.701z" />
      </g>
    </svg>
  );
}
