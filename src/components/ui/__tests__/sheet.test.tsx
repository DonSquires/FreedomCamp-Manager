import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

describe("SheetContent accessibility", () => {
  it("injects a hidden title when missing", () => {
    render(
      <Sheet open>
        <SheetContent>
          <div>Body content</div>
        </SheetContent>
      </Sheet>
    )

    expect(screen.getByRole("dialog", { name: "Sheet" })).toBeInTheDocument()
  })

  it("uses the provided title when present", () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>User settings</SheetTitle>
          <div>Body content</div>
        </SheetContent>
      </Sheet>
    )

    expect(screen.getByRole("dialog", { name: "User settings" })).toBeInTheDocument()
  })
})
