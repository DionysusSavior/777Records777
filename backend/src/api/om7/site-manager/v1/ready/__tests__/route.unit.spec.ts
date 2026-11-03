import { GET } from "../route"

/**
 * The outage this route exists for answered `/health` with OK throughout, so
 * the only thing worth asserting is that this one does NOT - and that it stays
 * quiet about why.
 */
const COMPLETE = {
  OM7_SITE_MANAGER_TOKEN_SHA256: "a".repeat(64),
  OM7_SITE_MANAGER_PUBLIC_BASE_URL: "https://example.test",
  OM7_SITE_MANAGER_RECEIPT_SECRET: "s".repeat(32),
  OM7_SITE_MANAGER_S3_BUCKET: "bucket",
  OM7_SITE_MANAGER_S3_REGION: "us-east-2",
}

const fakeResponse = () => {
  const sent: { status?: number; body?: unknown } = {}
  const res = {
    status(code: number) {
      sent.status = code
      return res
    },
    json(body: unknown) {
      sent.body = body
      return res
    },
  }
  return { res, sent }
}

const call = async () => {
  const { res, sent } = fakeResponse()
  await GET({} as never, res as never)
  return sent
}

describe("publishing readiness", () => {
  const original = { ...process.env }
  let logged: jest.SpyInstance

  beforeEach(() => {
    for (const key of Object.keys(COMPLETE)) delete process.env[key]
    logged = jest.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    process.env = { ...original }
    logged.mockRestore()
  })

  it("is ready when every required variable is present", async () => {
    Object.assign(process.env, COMPLETE)
    expect(await call()).toEqual({ status: 200, body: { publishing: "ready" } })
  })

  it.each(Object.keys(COMPLETE))("is NOT ready when %s is missing", async (missing) => {
    Object.assign(process.env, COMPLETE)
    delete process.env[missing]
    expect(await call()).toEqual({ status: 503, body: { publishing: "unconfigured" } })
  })

  it("is NOT ready when the digest is present but malformed", async () => {
    Object.assign(process.env, COMPLETE, { OM7_SITE_MANAGER_TOKEN_SHA256: "not-a-digest" })
    expect(await call()).toEqual({ status: 503, body: { publishing: "unconfigured" } })
  })

  it("never names the variable or its value in the response", async () => {
    Object.assign(process.env, COMPLETE)
    delete process.env.OM7_SITE_MANAGER_RECEIPT_SECRET
    const serialised = JSON.stringify((await call()).body)
    expect(serialised).not.toMatch(/OM7_SITE_MANAGER/)
    expect(serialised).not.toContain("s".repeat(32))
    expect(logged).toHaveBeenCalled()
  })
})
