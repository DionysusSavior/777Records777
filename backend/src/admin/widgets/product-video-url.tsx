import React, { useEffect, useMemo, useState } from "react"
import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Button, Input, Text } from "@medusajs/ui"
import { useParams } from "react-router-dom"

declare const __BACKEND_URL__: string
declare const __AUTH_TYPE__: "session" | "jwt"
declare const __JWT_TOKEN_STORAGE_KEY__: string

type ProductImage = {
  url: string
}

type ProductResponse = {
  product?: {
    id: string
    title?: string
    images?: ProductImage[]
  }
}

const isVideoUrl = (url?: string) => {
  if (!url) {
    return false
  }

  const path = url.split("?")[0].toLowerCase()
  return /\.(mp4|mov|webm|ogg)$/.test(path)
}

const getAuthHeaders = () => {
  if (__AUTH_TYPE__ === "jwt" && __JWT_TOKEN_STORAGE_KEY__) {
    const token = window.localStorage.getItem(__JWT_TOKEN_STORAGE_KEY__)
    if (token) {
      return { Authorization: `Bearer ${token}` }
    }
  }

  return {}
}

const ProductVideoWidget = () => {
  const { id } = useParams()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [images, setImages] = useState<string[]>([])
  const [videoUrl, setVideoUrl] = useState("")

  useEffect(() => {
    if (!id) {
      return
    }

    const controller = new AbortController()
    const fetchProduct = async () => {
      setLoading(true)
      setError(null)
      setSuccess(null)

      try {
        const res = await fetch(`${__BACKEND_URL__}/admin/products/${id}`, {
          credentials: "include",
          headers: {
            ...getAuthHeaders(),
          },
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error(
            `Failed to load product (${res.status} ${res.statusText})`
          )
        }

        const data = (await res.json()) as ProductResponse
        const urls =
          data?.product?.images?.map((img) => img.url).filter(Boolean) ?? []
        setImages(urls)

        const existingVideo = urls.find((url) => isVideoUrl(url))
        setVideoUrl(existingVideo ?? "")
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return
        }

        setError(
          err instanceof Error ? err.message : "Failed to load product data."
        )
      } finally {
        setLoading(false)
      }
    }

    fetchProduct()

    return () => controller.abort()
  }, [id])

  const nonVideoImages = useMemo(
    () => images.filter((url) => !isVideoUrl(url)),
    [images]
  )

  const handleSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!id) {
      return
    }

    setSaving(true)
    setError(null)
    setSuccess(null)

    const nextImages = videoUrl
      ? [videoUrl, ...nonVideoImages]
      : [...nonVideoImages]

    try {
      const res = await fetch(`${__BACKEND_URL__}/admin/products/${id}`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          images: nextImages,
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(
          body || `Update failed (${res.status} ${res.statusText})`
        )
      }

      setImages(nextImages)
      setSuccess("Saved. The video URL is now part of the product gallery.")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-ui-bg-base border border-ui-border shadow-elevation-card-rest rounded-lg">
      <div className="flex items-center justify-between px-6 py-4 border-b border-ui-border">
        <div>
          <Text size="small" weight="plus">
            Product video
          </Text>
          <Text size="small" leading="compact" className="text-ui-fg-subtle">
            Paste an MP4/WEBM/OGG URL to show a looping video in the storefront
            gallery.
          </Text>
        </div>
        {loading && <Text size="small">Loading…</Text>}
      </div>
      <form onSubmit={handleSave} className="space-y-4 px-6 py-4">
        <div className="space-y-2">
          <label className="text-ui-fg-subtle text-sm font-medium">
            Video URL (optional)
          </label>
          <Input
            type="url"
            placeholder="https://cdn.example.com/video.mp4"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            disabled={loading || saving}
          />
          <Text size="small" className="text-ui-fg-subtle">
            Leave blank to remove the video. Current media count:{" "}
            {nonVideoImages.length} image
            {nonVideoImages.length === 1 ? "" : "s"} +{" "}
            {videoUrl ? "1 video" : "0 videos"}.
          </Text>
        </div>

        {error && (
          <Text size="small" className="text-ui-fg-error">
            {error}
          </Text>
        )}
        {success && (
          <Text size="small" className="text-ui-fg-subtle">
            {success}
          </Text>
        )}

        <div className="flex gap-2">
          <Button type="submit" disabled={saving || loading}>
            {saving ? "Saving..." : "Save video URL"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={loading || saving}
            onClick={() => setVideoUrl("")}
          >
            Remove video
          </Button>
        </div>
      </form>
    </div>
  )
}

export const config = defineWidgetConfig({
  zone: "product.details.after",
})

export default ProductVideoWidget
