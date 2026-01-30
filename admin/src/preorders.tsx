import React, { useEffect, useMemo, useState } from "react"
import { Badge, Container, Heading, Table, Text } from "@medusajs/ui"

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
          `/admin/preorders?limit=${PAGE_SIZE}&offset=${offset}`,
          {
            credentials: "include",
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

  return (
    <Container className="divide-y p-0">
      <div className="px-6 py-4">
        <Heading>Preorders</Heading>
        <Text size="small" className="text-ui-fg-subtle">
          Shipping address submissions saved for upcoming releases.
        </Text>
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
                </Table.Row>
              </Table.Header>
              <Table.Body className="border-b-0">
                {pageItems.length === 0 && (
                  <Table.Row>
                    <Table.Cell colSpan={5}>
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

const preordersPlugin = {
  routeModule: {
    routes: [
      {
        path: "/preorders",
        Component: PreordersPage,
      },
    ],
  },
  menuItemModule: {
    menuItems: [
      {
        label: "Preorders",
        path: "/preorders",
        rank: 80,
      },
    ],
  },
  widgetModule: {
    widgets: [],
  },
  displayModule: {
    displays: {},
  },
  formModule: {
    customFields: {},
  },
}

export default preordersPlugin
