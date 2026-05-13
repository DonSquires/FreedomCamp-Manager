import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { Badge } from "@/components/ui/badge"

describe("Badge", () => {
  it("renders as an inline span", () => {
    render(<Badge>Status</Badge>)

    const badge = screen.getByText("Status")
    expect(badge.tagName).toBe("SPAN")
  })
})
