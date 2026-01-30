import React, { useEffect, useMemo, useState } from "react"
import { defineRouteConfig } from "@medusajs/admin-sdk"
import { Badge, Button, Container, Heading, Table, Text } from "@medusajs/ui"

declare const __BACKEND_URL__: string
declare const __AUTH_TYPE__: "session" | "jwt"
declare const __JWT_TOKEN_STORAGE_KEY__: string

type PreorderItem = {
  title?: string | null
  quantity?: number | null
  metadata?: Record<string, unknown> | null
}

type PreorderAddress = {
  first_name?: string | null
  last_name?: string | null
  address_1?: string | null
  address_2?: string | null
  city?: string | null
  postal_code?: string | null
  country_code?: string | null
  phone?: string | null
}

type Preorder = {
  id: string
  email?: string | null
  created_at?: string
  metadata?: Record<string, unknown> | null
  shipping_address?: PreorderAddress | null
  items?: PreorderItem[] | null
}

type PreordersResponse = {
  preorders: Preorder[]
  count: number
  offset: number
  limit: number
}

const PAGE_SIZE = 25

const getAuthHeaders = () => {
  if (__AUTH_TYPE__ === "jwt" && __JWT_TOKEN_STORAGE_KEY__) {
    const token = window.localStorage.getItem(__JWT_TOKEN_STORAGE_KEY__)
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
  }

  return {}
}

const formatDate = (value?: string) => {
  if (!value) {
    return "-"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

const formatAddress = (address?: PreorderAddress | null) => {
  if (!address) {
    return "-"
  }

  const line1 = address.address_1
  const line2 = address.address_2
  const city = address.city
  const postal = address.postal_code
  const country = address.country_code?.toUpperCase()

  return [line1, line2, city, postal, country].filter(Boolean).join(", ")
}

const getSubmittedAt = (preorder: Preorder) => {
  const submittedAt = preorder.metadata?.preorder_submitted_at
  if (typeof submittedAt === "string") {
    return submittedAt
  }

  return preorder.created_at
}

const PreordersPage = () => {
  const [preorders, setPreorders] = useState<Preorder[]>([])
  const [count, setCount] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Record<string, boolean>>({})

  const pageIndex = Math.floor(offset / PAGE_SIZE)
  const pageCount = Math.ceil(count / PAGE_SIZE)

  useEffect(() => {
    let isMounted = true
    const controller = new AbortController()

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `${__BACKEND_URL__}/admin/preorders?limit=${PAGE_SIZE}&offset=${offset}`,
          {
            credentials: "include",
            headers: {
              ...getAuthHeaders(),
            },
            signal: controller.signal,
          }
        )

        if (!response.ok) {
          throw new Error(`Failed to load preorders (${response.status})`)
        }

        const payload = (await response.json()) as PreordersResponse
        if (!isMounted) {
          return
        }

        setPreorders(payload.preorders || [])
        setCount(payload.count || 0)
      } catch (err) {
        if (!isMounted) {
          return
        }

        if (err instanceof DOMException && err.name === "AbortError") {
          return
        }

        setError(err instanceof Error ? err.message : "Failed to load preorders")
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
      controller.abort()
    }
  }, [offset])

  const canPreviousPage = offset > 0
  const canNextPage = offset + PAGE_SIZE < count

  const pageItems = useMemo(() => preorders, [preorders])

  const handleDownload = async () => {
    setExporting(true)
    setError(null)

    try {
      const response = await fetch(`${__BACKEND_URL__}/admin/preorders/export`, {
        credentials: "include",
        headers: {
          ...getAuthHeaders(),
        },
      })

      if (!response.ok) {
        throw new Error(`Failed to export preorders (${response.status})`)
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)

      const link = document.createElement("a")
      const disposition = response.headers.get("content-disposition")
      const match = disposition?.match(/filename="([^"]+)"/)
      link.href = url
      link.download = match?.[1] || "preorders.csv"
      document.body.appendChild(link)
      link.click()
      link.remove()

      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export preorders")
    } finally {
      setExporting(false)
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm(
      "Delete this preorder? This will remove it from the list."
    )
    if (!confirmed) {
      return
    }

    setDeletingIds((prev) => ({ ...prev, [id]: true }))
    setError(null)

    try {
      const response = await fetch(
        `${__BACKEND_URL__}/admin/preorders/${id}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: {
            ...getAuthHeaders(),
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to delete preorder (${response.status})`)
      }

      setPreorders((prev) => prev.filter((preorder) => preorder.id !== id))
      setCount((prev) => Math.max(prev - 1, 0))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete preorder")
    } finally {
      setDeletingIds((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4 flex items-start justify-between gap-4">
        <div>
          <Heading>Preorders</Heading>
          <Text size="small" className="text-ui-fg-subtle">
            Shipping address submissions saved for upcoming releases.
          </Text>
        </div>
        <Button
          size="small"
          variant="secondary"
          onClick={handleDownload}
          isLoading={exporting}
        >
          Download CSV
        </Button>
      </div>
      <div className="px-0">
        {loading && (
          <div className="px-6 py-6">
            <Text size="small" className="text-ui-fg-subtle">
              Loading preorders...
            </Text>
          </div>
        )}
        {!loading && error && (
          <div className="px-6 py-6">
            <Text size="small" className="text-ui-fg-subtle">
              {error}
            </Text>
          </div>
        )}
        {!loading && !error && (
          <>
            <Table className="relative w-full">
              <Table.Header className="border-t-0">
                <Table.Row>
                  <Table.HeaderCell>Submitted</Table.HeaderCell>
                  <Table.HeaderCell>Customer</Table.HeaderCell>
                  <Table.HeaderCell>Items</Table.HeaderCell>
                  <Table.HeaderCell>Shipping address</Table.HeaderCell>
                  <Table.HeaderCell>Status</Table.HeaderCell>
                  <Table.HeaderCell className="text-right">
                    Actions
                  </Table.HeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body className="border-b-0">
                {pageItems.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={6}>
                      <Text size="small" className="text-ui-fg-subtle">
                        No preorders yet.
                      </Text>
                    </Table.Cell>
                  </Table.Row>
                )}
                {pageItems.map((preorder) => {
                  const items = preorder.items ?? []
                  const name = [
                    preorder.shipping_address?.first_name,
                    preorder.shipping_address?.last_name,
                  ]
                    .filter(Boolean)
                    .join(" ")

                  return (
                    <Table.Row key={preorder.id}>
                      <Table.Cell>
                        <Text size="small">
                          {formatDate(getSubmittedAt(preorder))}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col">
                          <Text size="small" weight="plus">
                            {preorder.email || "Unknown email"}
                          </Text>
                          {name && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {name}
                            </Text>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col gap-1">
                          {items.slice(0, 3).map((item, index) => (
                            <Text size="xsmall" key={`${preorder.id}-${index}`}>
                              {item.title || "Item"} x{item.quantity ?? 0}
                              {typeof item.metadata?.preorder_size === "string"
                                ? ` - Size: ${item.metadata.preorder_size}`
                                : ""}
                            </Text>
                          ))}
                          {items.length > 3 && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              +{items.length - 3} more
                            </Text>
                          )}
                          {items.length === 0 && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              No items
                            </Text>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="flex flex-col">
                          <Text size="xsmall">
                            {formatAddress(preorder.shipping_address)}
                          </Text>
                          {preorder.shipping_address?.phone && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {preorder.shipping_address.phone}
                            </Text>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge color="green">Submitted</Badge>
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => handleDelete(preorder.id)}
                          isLoading={Boolean(deletingIds[preorder.id])}
                        >
                          Delete
                        </Button>
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
            <Table.Pagination
              count={count}
              pageIndex={pageIndex}
              pageSize={PAGE_SIZE}
              pageCount={pageCount}
              canPreviousPage={canPreviousPage}
              canNextPage={canNextPage}
              previousPage={() =>
                setOffset((prev) => Math.max(prev - PAGE_SIZE, 0))
              }
              nextPage={() => setOffset((prev) => prev + PAGE_SIZE)}
            />
          </>
        )}
      </div>
    </Container>
  )
}

export const config = defineRouteConfig({
  label: "Preorders",
  rank: 80,
})

export default PreordersPage
