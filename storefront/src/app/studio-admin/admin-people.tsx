"use client"
import { useEffect, useState } from "react"

type Status = {
  admin: boolean
  canSetup: boolean
  members: { sub: string; email: string }[]
  invites: { id: string; email: string }[]
}
const key = "studio-admin.adminInvite"
export function captureAdminInvite() {
  const id = new URLSearchParams(window.location.search).get("adminInvite")
  if (id && /^[a-f0-9-]{36}$/.test(id)) window.sessionStorage.setItem(key, id)
}
export default function AdminPeople({
  token,
  serviceUrl,
  refresh,
}: {
  token: string
  serviceUrl: string
  refresh: () => Promise<void>
}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [email, setEmail] = useState("")
  const [notice, setNotice] = useState("")
  const [link, setLink] = useState("")
  const [busy, setBusy] = useState(false)
  const [invite, setInvite] = useState<string | null>(null)
  async function call(path: string, body?: object) {
    const response = await fetch(
      `${serviceUrl.replace(/\/$/, "")}/people/${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        credentials: "omit",
        cache: "no-store",
        ...(body ? { body: JSON.stringify(body) } : {}),
      }
    )
    const data = await response.json()
    if (!response.ok)
      throw new Error(
        data.error?.message ?? "Unable to update access. Try again."
      )
    return data
  }
  useEffect(() => {
    setInvite(window.sessionStorage.getItem(key))
    let active = true
    void call("status")
      .then((data) => {
        if (active) setStatus(data)
      })
      .catch((error) => {
        if (active) setNotice(error.message)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, serviceUrl])
  async function change(path: string, body: object) {
    if (busy) return
    setBusy(true)
    setNotice("")
    setLink("")
    try {
      const data = await call(path, body)
      if (path === "accept") {
        window.sessionStorage.removeItem(key)
        setInvite(null)
      }
      if (data.acceptUrl) {
        setLink(data.acceptUrl)
        setNotice(
          data.mailed
            ? "Administrator invitation sent."
            : "Email could not be sent. Share the invitation link below."
        )
      } else
        setNotice(
          "Administrator access updated. Publishing permissions are unchanged."
        )
      setStatus(await call("status"))
      await refresh()
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Unable to update access."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="flex flex-col gap-4 rounded border border-white/20 p-5">
      <h2 className="text-lg font-bold">People · Administration</h2>
      <p className="text-sm text-white/70">
        Administrators can invite people and manage access. Publishing to an
        artist’s page is a separate permission, managed below.
      </p>
      {status?.canSetup && (
        <button disabled={busy} onClick={() => void change("setup", {})}>
          Set up this site’s administrators
        </button>
      )}
      {invite && (
        <div className="flex flex-col gap-2">
          <p>
            You have an administrator invitation. Accept only if you want to
            manage this site’s access.
          </p>
          <button
            disabled={busy}
            onClick={() => void change("accept", { inviteId: invite })}
          >
            Accept administrator invitation
          </button>
          <button
            onClick={() => {
              window.sessionStorage.removeItem(key)
              setInvite(null)
            }}
          >
            Dismiss invitation
          </button>
        </div>
      )}
      {status?.admin && (
        <>
          <label className="flex flex-col gap-2">
            Administrator email
            <input
              type="email"
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-white/30 bg-black p-3"
            />
          </label>
          <button
            disabled={busy || !email.trim()}
            onClick={() => void change("invite", { email })}
          >
            Invite administrator
          </button>
          <ul className="flex flex-col gap-3">
            {status.members.map((member) => (
              <li key={member.sub} className="break-all">
                {member.email || `Initial owner · ${member.sub}`}
                <button
                  className="ml-3"
                  disabled={busy || status.members.length === 1}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Remove administrator rights? Their separate publishing permissions will remain."
                      )
                    )
                      void change("remove", { sub: member.sub })
                  }}
                >
                  Remove admin
                </button>
              </li>
            ))}
          </ul>
          {status.members.length === 1 && (
            <p className="text-sm text-white/70">
              Invite another administrator before removing the last one.
            </p>
          )}
          {status.invites.map((item) => (
            <div key={item.id}>
              {item.email} · pending{" "}
              <button
                disabled={busy}
                onClick={() => void change("cancel", { inviteId: item.id })}
              >
                Cancel invitation
              </button>
            </div>
          ))}
        </>
      )}
      {notice && <p role="status">{notice}</p>}
      {link && (
        <label className="flex flex-col gap-2">
          Administrator invitation link
          <textarea readOnly value={link} className="rounded bg-black p-3" />
        </label>
      )}
    </section>
  )
}
