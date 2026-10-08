# Core development

The workspace core builds blogs and validates Presentation IR v2. AI tools and
the agent contract use JSON Schema generated from the same Zod definitions.
References, placement and contrast are checked by the runtime validator; JSON
Schema describes structure and does not replace those checks.

The exported `blogDesignSpecV2Schema`, `homePageSpecV2Schema`,
`presentationSpecSchema`, `contentProfileSchema` and `sourceSnapshotV1Schema`
are Zod 4 schemas. Consumers composing them must use Zod 4, or call the exported
validation functions instead. IR data and existing validator exports are unchanged.

This workspace package remains private. Updating the older npm package requires
a separate release and API migration guide.
