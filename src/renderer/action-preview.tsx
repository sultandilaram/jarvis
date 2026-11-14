import React, { useState } from "react";
import { Crosshair } from "lucide-react";
import { withoutInlineImages } from "../shared/image-history";
import "./action-preview.css";

const labels: Record<string, string> = {
  path: "File path",
  source: "From",
  destination: "To",
  before: "Current content",
  after: "New content",
  text: "Exact text",
  content: "Content",
  url: "Website",
  bundleId: "Application",
  application: "Application",
  window: "Window",
  element: "Target control",
  pageContext: "Page context",
  context: "Window context",
  beforeSha256: "Current file fingerprint",
  sha256: "File fingerprint",
};
function label(key: string) {
  return (
    (Object.hasOwn(labels, key) ? labels[key] : "") ||
    key
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase())
  );
}
function Value({ value }: { value: unknown }) {
  if (value === null) return <p className="preview-none">None supplied</p>;
  if (Array.isArray(value))
    return (
      <ol className="preview-list">
        {value.map((item, index) => (
          <li key={index}>
            <Value value={item} />
          </li>
        ))}
      </ol>
    );
  if (typeof value === "object")
    return (
      <dl className="preview-object">
        {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
          <div className="preview-field" key={key}>
            <dt>{label(key)}</dt>
            <dd>
              <Value value={item} />
            </dd>
          </div>
        ))}
      </dl>
    );
  if (value === "")
    return <p className="preview-none">Empty text (0 characters)</p>;
  return <pre>{String(value)}</pre>;
}
export function ActionPreview({ params }: { params: Record<string, any> }) {
  const [zoom, setZoom] = useState(false);
  const preview =
    params.preview && typeof params.preview === "object" ? params.preview : {};
  const extra = Object.fromEntries(
    Object.entries(params).filter(
      ([k]) =>
        ![
          "title",
          "action",
          "reason",
          "voiceId",
          "preview",
          "availableDecisions",
        ].includes(k),
    ),
  );
  const hasImage =
    typeof preview.imageUrl === "string" &&
    /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(
      preview.imageUrl,
    ) &&
    preview.imageUrl.length < 1400000 &&
    Number.isFinite(preview.imageWidth) &&
    preview.imageWidth > 0 &&
    Number.isFinite(preview.imageHeight) &&
    preview.imageHeight > 0;
  return (
    <div className="action-preview">
      {params.action && (
        <p className="preview-operation">
          {(
            {
              "files.write": "Write a text file",
              "files.move": "Move a file",
              "files.trash": "Move a file to Trash",
              "files.open": "Open a file",
              "files.request_folder": "Choose a folder to grant access",
              "apps.open": "Open an application",
              "desktop.press": "Press a control",
              "desktop.type": "Replace control text",
              "browser.navigate": "Open a website",
              "browser.click": "Click a browser control",
              "browser.type": "Type into a browser control",
            } as Record<string, string>
          )[params.action] || String(params.action).replaceAll(".", " / ")}
        </p>
      )}
      {params.reason && <p className="preview-reason">{params.reason}</p>}
      {hasImage && (
        <figure className="visual-approval">
          <figcaption>Review the marked point</figcaption>
          <p>
            Check the conversation, content and intended effect before
            approving.
          </p>
          <button
            type="button"
            className="subtle"
            onClick={() => setZoom(!zoom)}
          >
            {zoom ? "Fit image" : "Inspect full-size image"}
          </button>
          <div className="visual-approval-scroll">
            <div
              className={"visual-approval-image" + (zoom ? " is-zoomed" : "")}
              style={zoom ? { width: preview.imageWidth } : undefined}
            >
              <img
                src={preview.imageUrl}
                alt={
                  "Captured " +
                  (preview.window || "app") +
                  " window for this exact click"
                }
              />
              {preview.point && (
                <span
                  className="visual-approval-point"
                  style={{
                    left: (100 * preview.point.x) / preview.imageWidth + "%",
                    top: (100 * preview.point.y) / preview.imageHeight + "%",
                  }}
                  aria-label="Proposed click point"
                >
                  <Crosshair size={28} strokeWidth={2} />
                </span>
              )}
            </div>
          </div>
          {zoom && (
            <p>Scroll within the image to inspect it at its original size.</p>
          )}
        </figure>
      )}
      {params.action === "desktop.click_image" && !hasImage && (
        <p role="alert">
          The window image is unavailable in this client. Review on the Mac or
          update this client before approving.
        </p>
      )}
      <dl>
        {Object.entries({ ...extra, ...preview })
          .filter(([key]) => key !== "imageUrl")
          .map(([key, value]) => (
            <div className="preview-field" key={key}>
              <dt>{label(key)}</dt>
              <dd>
                <Value value={value} />
              </dd>
            </div>
          ))}
      </dl>
      <details className="technical-preview">
        <summary>Technical details</summary>
        <pre>{JSON.stringify(withoutInlineImages(params), null, 2)}</pre>
      </details>
    </div>
  );
}
