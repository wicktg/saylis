"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useWalletAuth } from "@/app/_lib/useWalletAuth";

type Step = "input" | "code" | "confirming" | "success";

/**
 * Ownership of an X account is proven by asking the user to paste a random
 * code into their own bio, then checking for it via a read-only public API
 * — no password, no OAuth consent screen. See app/api/x/verify/{start,confirm}.
 */
export default function ConnectXModal({
  open,
  onClose,
  wallet,
  onLinked,
}: {
  open: boolean;
  onClose: () => void;
  wallet: Address;
  onLinked: () => void;
}) {
  const { authorize } = useWalletAuth();
  const [step, setStep] = useState<Step>("input");
  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkedUsername, setLinkedUsername] = useState("");

  // Fresh state each time the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setStep("input");
      setUsername("");
      setCode("");
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && step !== "confirming") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, step, onClose]);

  if (!open) return null;

  async function handleGenerateCode(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const handle = username.trim();
    if (!handle) return;

    try {
      const res = await fetch("/api/x/verify/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(await authorize("x:verify-start")), username: handle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setCode(data.code);
      setStep("code");
    } catch {
      setError("Could not reach the server.");
    }
  }

  async function handleConfirm() {
    setError(null);
    setStep("confirming");
    try {
      const res = await fetch("/api/x/verify/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(await authorize("x:verify-confirm")) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Verification failed.");
        setStep("code");
        return;
      }
      setLinkedUsername(data.username);
      setStep("success");
      onLinked();
    } catch {
      setError("Could not reach the server.");
      setStep("code");
    }
  }

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Clipboard access denied — the code is still visible to copy by hand.
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="pixel-frame pixel-panel relative w-full max-w-sm mx-4 p-6">
        <button
          onClick={onClose}
          disabled={step === "confirming"}
          aria-label="Close"
          className="absolute right-4 top-4 text-white/40 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <iconify-icon icon="pixelarticons:close" className="text-base" />
        </button>

        <div className="flex items-center gap-2 mb-5">
          <iconify-icon icon="ri:twitter-x-fill" className="text-white text-lg" />
          <h2 className="text-base font-bold">Connect X</h2>
        </div>

        {step === "input" && (
          <form onSubmit={handleGenerateCode} className="flex flex-col gap-3">
            <p className="text-[11px] text-white/50 leading-relaxed">
              Enter your X username. We&apos;ll give you a code to paste into your bio to prove
              it&apos;s really you. No password, no login required.
            </p>

            <div className="pixel-frame pixel-input px-3 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-white/30">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="username"
                  autoFocus
                  maxLength={15}
                  className="w-full bg-transparent text-sm focus:outline-none placeholder:text-white/30"
                />
              </div>
            </div>

            {error && <p className="text-[11px] font-bold text-white">{error}</p>}

            <button
              type="submit"
              disabled={!username.trim()}
              className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm mt-1 disabled:cursor-not-allowed"
            >
              Generate Code
            </button>
          </form>
        )}

        {(step === "code" || step === "confirming") && (
          <div className="flex flex-col gap-3">
            <p className="text-[11px] text-white/50 leading-relaxed">
              Paste this code anywhere in your X bio for{" "}
              <span className="text-white font-bold">@{username.trim()}</span>, save it, then hit
              Confirm.
            </p>

            <button
              onClick={handleCopyCode}
              className="pixel-frame pixel-input flex items-center justify-between px-3 py-2.5 group"
            >
              <span className="text-lg font-black tracking-[0.2em] text-[var(--accent)]">
                {code}
              </span>
              <iconify-icon
                icon="pixelarticons:copy"
                className="text-white/40 group-hover:text-white text-sm"
              />
            </button>

            {error && <p className="text-[11px] font-bold text-white">{error}</p>}

            <div className="flex gap-2 mt-1">
              <button
                onClick={() => setStep("input")}
                disabled={step === "confirming"}
                className="pixel-frame pixel-btn-ghost flex-1 text-white/70 font-bold py-2.5 text-sm disabled:cursor-not-allowed"
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={step === "confirming"}
                className="pixel-frame pixel-btn flex-[2] text-white font-bold py-2.5 text-sm disabled:cursor-not-allowed"
              >
                {step === "confirming" ? "Checking bio..." : "Confirm"}
              </button>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center text-center py-4 gap-3">
            <iconify-icon icon="pixelarticons:check" className="text-3xl text-[var(--accent)]" />
            <p className="text-sm font-bold">@{linkedUsername} linked.</p>
            <p className="text-[11px] text-white/40 leading-relaxed">
              You can remove the code from your bio now.
            </p>
            <button
              onClick={onClose}
              className="pixel-frame pixel-btn w-full text-white font-bold py-2.5 text-sm mt-2"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
