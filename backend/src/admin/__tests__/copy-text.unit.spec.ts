import { copyText } from "../routes/om7-credential/copy-text"

/**
 * The bug being guarded: the credential copy button did nothing and said
 * nothing, so the token had to be highlighted by hand. These assert the two
 * properties that made it dead — that the copy happens synchronously inside
 * the call, and that a refusal is reported rather than swallowed.
 */

type Fake = { doc: Document; selected: string[]; removed: number }

const fakeDoc = (opts: {
  execCommand?: () => boolean
  selection?: boolean
} = {}): Fake => {
  const selected: string[] = []
  let removed = 0
  const doc = {
    body: {
      appendChild() {},
      removeChild() {
        removed += 1
      },
    },
    createElement() {
      const area = {
        value: "",
        style: { position: "", top: "", left: "", opacity: "", fontSize: "" },
        contentEditable: "",
        readOnly: true,
        setSelectionRange(start: number, end: number) {
          selected.push(area.value.slice(start, end))
        },
      }
      return area
    },
    createRange() {
      return { selectNodeContents() {} }
    },
    getSelection() {
      return opts.selection === false
        ? null
        : { removeAllRanges() {}, addRange() {} }
    },
    execCommand: opts.execCommand ?? (() => true),
  } as unknown as Document
  return {
    doc,
    selected,
    get removed() {
      return removed
    },
  }
}

describe("copyText", () => {
  it("copies the whole credential, not a prefix of it", () => {
    const f = fakeDoc()
    const token = "om7-studio:0ac1f9d4e7b24c118a3f5e6d7c8b9a01"
    expect(copyText(token, f.doc)).toBe(true)
    expect(f.selected[0]).toBe(token)
  })

  it("selects inside the call, so the click's activation is still live", () => {
    const f = fakeDoc()
    // Nothing is awaited: by the time copyText returns, the selection and the
    // copy have both already happened. This is the property the old
    // navigator.clipboard version lost.
    copyText("abc", f.doc)
    expect(f.selected).toEqual(["abc"])
  })

  it("reports a refusal instead of claiming success", () => {
    const f = fakeDoc({ execCommand: () => false })
    expect(copyText("abc", f.doc)).toBe(false)
  })

  it("survives a browser that throws on execCommand", () => {
    const f = fakeDoc({
      execCommand: () => {
        throw new Error("not allowed")
      },
    })
    expect(copyText("abc", f.doc)).toBe(false)
  })

  it("cleans up the textarea even when the copy fails", () => {
    const f = fakeDoc({
      execCommand: () => {
        throw new Error("not allowed")
      },
    })
    copyText("abc", f.doc)
    expect(f.removed).toBe(1)
  })

  it("does nothing for an empty value", () => {
    const f = fakeDoc()
    expect(copyText("", f.doc)).toBe(false)
    expect(f.selected).toEqual([])
  })

  it("still copies where getSelection returns nothing", () => {
    const f = fakeDoc({ selection: false })
    expect(copyText("abc", f.doc)).toBe(true)
  })
})
