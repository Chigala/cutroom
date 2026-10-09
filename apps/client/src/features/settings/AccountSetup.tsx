/**
 * Settings → Account: the Cutroom account this computer is signed in to, or the ways to sign in. Signing
 * in happens in the browser, with Google, Apple or GitHub; Cutroom never sees a password.
 */
import {
  AppleLogoIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  GithubLogoIcon,
  GoogleLogoIcon,
  UserIcon,
} from "@phosphor-icons/react";
import type { AccountProvider } from "@vedit/bridge";
import { clsx } from "clsx";
import { useEffect } from "react";
import { Button } from "../../components/ui.tsx";
import {
  cancelSignIn,
  checkAccount,
  signInAccount,
  signOutAccount,
  useAccount,
} from "../../state/account.ts";

const WAYS: Record<AccountProvider, { label: string; icon: typeof GoogleLogoIcon }> = {
  google: { label: "Continue with Google", icon: GoogleLogoIcon },
  apple: { label: "Continue with Apple", icon: AppleLogoIcon },
  github: { label: "Continue with GitHub", icon: GithubLogoIcon },
};

/** The ways in, one button each; or, while the browser's open, a way to stop waiting. */
export function SignInButtons({ wide }: { wide?: boolean }) {
  const { status, signingIn } = useAccount();
  if (!status)
    return (
      <div className="flex items-center gap-2.5 text-[13px] text-muted">
        <CircleNotchIcon size={14} className="animate-spin" /> Checking…
      </div>
    );
  if (signingIn)
    return (
      <div className="flex items-center gap-2.5 text-[13px] text-muted">
        <CircleNotchIcon size={14} className="animate-spin" /> Finish signing in in your browser…
        <Button size="sm" onClick={cancelSignIn}>
          Cancel
        </Button>
      </div>
    );
  if (status.providers.length === 0)
    return (
      <span className="text-[13px] leading-relaxed text-muted">
        Can't reach Cutroom right now. You can sign in later, from Settings.
      </span>
    );
  return (
    <div className={clsx("flex gap-2", wide ? "flex-col" : "flex-wrap")}>
      {status.providers.map((p) => {
        const { label, icon: Logo } = WAYS[p];
        return (
          <button
            key={p}
            type="button"
            onClick={() => void signInAccount(p)}
            className={clsx(
              "flex items-center justify-center gap-2 rounded-full border border-line-strong bg-raised font-medium text-fg transition-colors hover:bg-button",
              wide ? "h-11 text-[14px]" : "h-[34px] px-4 text-[13px]",
            )}
          >
            <Logo size={wide ? 17 : 15} weight="bold" /> {label}
          </button>
        );
      })}
    </div>
  );
}

export function AccountSetup() {
  const { status } = useAccount();
  useEffect(() => {
    void checkAccount();
  }, []);

  if (!status)
    return (
      <div className="flex items-center gap-2.5 rounded-xl bg-sunken/70 px-4 py-3.5 text-[13.5px] text-muted">
        <CircleNotchIcon size={14} className="animate-spin" /> Checking your account…
      </div>
    );
  if (!status.available)
    return (
      <div className="rounded-xl bg-sunken/70 px-4 py-3.5 text-[13.5px] text-muted">
        This build of Cutroom has no accounts to sign in to.
      </div>
    );

  const user = status.user;
  return (
    <div className="flex flex-col gap-3.5 rounded-xl bg-sunken/70 px-4 py-4">
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "flex size-8 shrink-0 items-center justify-center rounded-full",
            user ? "bg-ok/12 text-ok" : "bg-raised text-fg-2",
          )}
        >
          {user ? <CheckCircleIcon size={17} weight="fill" /> : <UserIcon size={16} />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1 pt-px">
          <span className="truncate text-[14px] font-medium text-fg">
            {user ? user.name || user.email : "Not signed in"}
          </span>
          {user ? (
            <span className="truncate text-[13px] text-muted">
              {user.email}
              {status.offline && " · offline"}
            </span>
          ) : (
            <span className="text-[13px] leading-relaxed text-muted">
              Your account is for updates and what you buy. Your footage never leaves this computer.
            </span>
          )}
        </div>
      </div>
      {user ? (
        <div>
          <Button size="sm" onClick={() => void signOutAccount()}>
            Sign out
          </Button>
        </div>
      ) : (
        <SignInButtons />
      )}
    </div>
  );
}
