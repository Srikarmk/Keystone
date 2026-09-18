"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Account {
  user: { name: string | null; image: string | null } | null;
  canSignIn: boolean;
}

/**
 * The one piece of account UI in the header.
 *
 * Renders nothing until it knows, rather than guessing "signed out" and flickering.
 * Signed in it shows the face; signed out it offers the door; with sign-in
 * unconfigured it still links to the profile, because the reading list there works for
 * a guest and is the only thing an account would have carried anyway.
 */
export function AccountMenu() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/account")
      .then((r) => r.json())
      .then((a: Account) => {
        if (live) setAccount(a);
      })
      .catch(() => {
        if (live) setAccount({ user: null, canSignIn: false });
      });
    return () => {
      live = false;
    };
  }, []);

  if (account === null) return <span className="w-14" aria-hidden />;

  if (account.user) {
    return (
      <Link
        href="/profile"
        className="flex items-center gap-2 text-[0.8rem] text-ink-soft transition-colors hover:text-brass"
        title={account.user.name ?? "Profile"}
      >
        {account.user.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={account.user.image}
            alt=""
            width={22}
            height={22}
            className="h-[22px] w-[22px] border border-paper-edge object-cover"
          />
        ) : null}
        <span className="hidden sm:inline">{account.user.name ?? "profile"}</span>
      </Link>
    );
  }

  return (
    <Link
      href={account.canSignIn ? "/signin" : "/profile"}
      className="text-[0.8rem] italic text-ink-soft transition-colors hover:text-brass"
    >
      {account.canSignIn ? "sign in" : "profile"}
    </Link>
  );
}
