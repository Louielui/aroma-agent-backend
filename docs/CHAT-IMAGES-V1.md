# Chat images v1

The ordinary chat composer accepts clipboard images and files selected from its
plus menu. PNG, JPEG and WebP are decoded in the browser and normalized to PNG.
It shows removable previews before Send and retains successful attachments in
the protected conversation history for reloads. Clipboard text remains ordinary
text. Unsupported formats and failed requests are visible; failed requests keep
their images in the composer.

Limits: four images per turn, each original file at most 20 MB and 80 million
pixels. Normalization caps the longest dimension at 2048 pixels and shrinks further
to meet the 1.5 MB wire limit. The server accepts only bounded canonical PNG data
URLs with a valid chunk structure and dimensions, never filesystem paths, remote
image URLs or SVG. Only `/api/v1/demo/image-intake` has the 9 MB JSON body allowance;
ordinary endpoints retain their existing 50 KB cap.

The existing Owner session, demo guard and same-origin checks apply. The route
uses the selected GPT subscription model and thinking level, with no paid API-key
fallback. Its provider bridge retains the image pixels. The model receives the
current images and up to eight bounded text turns loaded from the server's store.
The returned model identity must match the selection. Images and their text have
no authority to approve work or run tools. This route does not dispatch, send mail,
read the desktop or import images into long-term memory.

The store records normalized pixels, dimensions and SHA-256 alongside the user
message, atomically with the reply. A history write failure remains visible through
the existing `historySaved` signal. General document uploads, vision through other
provider adapters, automatic OCR indexing and reuse of earlier image pixels in
later turns remain unconnected. The architecture checklist marks this component
partially connected and states these limits.

Acceptance combines HTTP validation and persistence tests, an authenticated bridge
test above the former 1 MB cap, the full backend suite, and a live browser clipboard
paste followed by a real model description and a conversation reload. A visible
preview alone is not evidence that the model received the image.
