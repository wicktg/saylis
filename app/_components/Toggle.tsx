"use client";

export default function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`shrink-0 relative w-9 h-5 rounded-full transition-colors ${
        disabled
          ? "bg-white/10 cursor-not-allowed"
          : checked
            ? "bg-[#cf38dd]"
            : "bg-white/10"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full transition-transform ${
          disabled ? "bg-white/30" : "bg-black"
        } ${checked ? "translate-x-4" : "translate-x-0"}`}
      />
    </button>
  );
}
