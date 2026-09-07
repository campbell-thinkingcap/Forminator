# Notification Rule Collection (broken fixture)

Deliberately broken: the second document carries `enabled: "yes"` (a string)
where the schema declares a boolean. Lint must report exactly one
`sample-validates` error whose path carries the element index (`/1/enabled`).
