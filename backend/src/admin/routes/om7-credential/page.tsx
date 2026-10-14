import React, { useCallback, useEffect, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Text } from "@medusajs/ui"

declare const __BACKEND_URL__: string
declare const __AUTH_TYPE__: "session" | "jwt"
declare const __JWT_TOKEN_STORAGE_KEY__: string

type Setting = { name: string; set: boolean }
type Status = { configured: boolean; settings: Setting[] }
type Issued = { token: string; tokenSha256: string; envName: string }

// Typed explicitly: without it the union of "has Authorization" and "has not"
// is not assignable to HeadersInit, which is the error the preorders page
// carries four times over.
const getAuthHeaders = (): Record<string, string> => {
  if (__AUTH_TYPE__ === "jwt" && __JWT_TOKEN_STORAGE_KEY__) {
    const token = window.localStorage.getItem(__JWT_TOKEN_STORAGE_KEY__)
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
  }
  return {}
}

const Copyable = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 break-all rounded bg-ui-bg-subtle px-2 py-1 text-xs">
        {value}
      </code>
      <Button
        size="small"
        variant="secondary"
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            },
            () => setCopied(false),
          )
        }}
      >
        {copied ? "Copied" : `Copy ${label}`}
      </Button>
    </div>
  )
}

/**
 * Where an artist gets their OM7 publishing credential.
 *
 * This page exists because the OM7 app asked for a "publishing credential" and
 * there was nowhere to obtain one — the real answer was an environment
 * variable name buried in the backend source, which is no answer for anybody
 * who did not write it.
 *
 * The token is shown ONCE and is never stored. The server only ever holds its
 * SHA-256 digest, so there is no second copy to come back for; generating
 * again is the only way to recover from losing it, and that invalidates the
 * previous one.
 */
const Om7CredentialPage = () => {
  const [status, setStatus] = useState<Status | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`${__BACKEND_URL__}/admin/om7-credential`, {
        credentials: "include",
        headers: { ...getAuthHeaders() },
      })
      if (!response.ok) {
        throw new Error(`Status check failed (${response.status})`)
      }
      setStatus((await response.json()) as Status)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`${__BACKEND_URL__}/admin/om7-credential`, {
        method: "POST",
        credentials: "include",
        headers: { ...getAuthHeaders() },
      })
      if (!response.ok) {
        throw new Error(`Could not generate a credential (${response.status})`)
      }
      setIssued((await response.json()) as Issued)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const missing = status?.settings.filter((s) => !s.set) ?? []

  return (
    <Container className="divide-y p-0">
      <div className="flex flex-col gap-2 px-6 py-4">
        <Heading level="h1">OM7 publishing credential</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          The OM7 app publishes songs, reels and videos straight from a phone
          into this site&rsquo;s storage. It needs one credential, issued here.
          This site never stores the credential itself — only a fingerprint of
          it — so it is shown once and cannot be looked up again.
        </Text>
      </div>

      <div className="flex flex-col gap-3 px-6 py-4">
        <div className="flex items-center gap-2">
          <Heading level="h2">Status</Heading>
          {status === null ? (
            <Badge size="small">Checking…</Badge>
          ) : status.configured ? (
            <Badge size="small" color="green">Ready to publish</Badge>
          ) : (
            <Badge size="small" color="orange">Not set up yet</Badge>
          )}
        </div>
        {missing.length > 0 && (
          <div className="flex flex-col gap-1">
            <Text size="small" className="text-ui-fg-subtle">
              Still to set on this server:
            </Text>
            {missing.map((s) => (
              <code key={s.name} className="text-xs text-ui-fg-subtle">{s.name}</code>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 px-6 py-4">
        <Heading level="h2">Generate</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Generating a new credential replaces any credential already in use. A
          phone connected with the old one stops publishing until it is given
          the new one.
        </Text>
        <div>
          <Button onClick={generate} isLoading={busy} disabled={busy}>
            {issued ? "Generate another" : "Generate credential"}
          </Button>
        </div>

        {error && (
          <Text size="small" className="text-ui-fg-error">{error}</Text>
        )}

        {issued && (
          <div className="flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex flex-col gap-1">
              <Text weight="plus" size="small">1. Paste this into the OM7 app</Text>
              <Text size="small" className="text-ui-fg-subtle">
                Publish &rarr; Connect this phone. Shown once — copy it now.
              </Text>
              <Copyable label="credential" value={issued.token} />
            </div>

            <div className="flex flex-col gap-1">
              <Text weight="plus" size="small">
                2. Set this on your server, then redeploy
              </Text>
              <Text size="small" className="text-ui-fg-subtle">
                Environment variable <code>{issued.envName}</code>. This is the
                fingerprint, not the credential — it cannot be used to publish,
                so it is safe to paste into a hosting dashboard.
              </Text>
              <Copyable label="fingerprint" value={issued.tokenSha256} />
            </div>

            <Text size="small" className="text-ui-fg-subtle">
              Until the server has the fingerprint, the app will say the site is
              unavailable rather than that the credential is wrong.
            </Text>
          </div>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "OM7 publishing",
  rank: 90,
})

export default Om7CredentialPage
