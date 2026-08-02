"use client";

import {
  resolveSocialUrl,
  SOCIAL_ICONS,
  SOCIAL_LABELS,
  type SocialKind,
} from "@/app/_lib/socialLinks";
import type { TokenSocials } from "@/app/_lib/types";
import Icon from "@/app/_components/Icon";

const ORDER: SocialKind[] = ["x", "telegram", "website"];

/**
 * The token's X / Telegram / Website links, as set by its creator at mint.
 *
 * Only renders an icon when that field resolves to a safe http(s) URL, so a
 * token with nothing configured shows nothing rather than dead buttons, and
 * an unsafe value is dropped entirely (see `resolveSocialUrl`).
 *
 * `rel="noopener noreferrer"` is not optional here: these destinations are
 * creator-supplied, and without `noopener` the opened page can reach back
 * through `window.opener` and navigate this tab somewhere else.
 */
export default function TokenSocialLinks({ socials }: { socials: TokenSocials | null }) {
  if (!socials) return null;

  const links = ORDER.map((kind) => ({
    kind,
    url: resolveSocialUrl(kind, socials[kind]),
  })).filter((link): link is { kind: SocialKind; url: string } => link.url !== null);

  if (links.length === 0) return null;

  return (
    <div className="flex items-center gap-1 shrink-0 self-center">
      {links.map(({ kind, url }) => (
        <a
          key={kind}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={SOCIAL_LABELS[kind]}
          className="w-4 h-4 flex items-center justify-center shrink-0 self-center text-white/40 hover:text-white transition-colors"
        >
          <Icon
            icon={SOCIAL_ICONS[kind]}
            className="text-[10px] leading-none translate-y-[1.5px]"
          />
        </a>
      ))}
    </div>
  );
}
