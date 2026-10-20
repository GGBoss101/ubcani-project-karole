"use client";

// A bar under a scrolling list that drags its height up or down, like the grip on a text box.
// Mouse, touch and keyboard (arrow keys, Home, End) all work; a double click goes back to the
// default height. The list never gets taller than its rows need or than 90% of the window,
// nor shorter than 10rem.
import { useRef } from "react";

// How far one arrow key press moves it, in pixels.
const KEY_STEP = 32;

function heightLimits(box) {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const min = 10 * rem;
    return { min, max: Math.max(min, Math.min(box.scrollHeight, window.innerHeight * 0.9)) };
}

function clampHeight(box, height) {
    const { min, max } = heightLimits(box);
    return Math.round(Math.min(max, Math.max(min, height)));
}

export default function ListResizeHandle({ targetRef, value, onResize, onReset, className }) {
    const drag = useRef(null);

    function startDrag(event) {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const height = targetRef.current.getBoundingClientRect().height;
        drag.current = { startY: event.clientY, startHeight: height };
    }

    function moveDrag(event) {
        if (!drag.current) return;
        const { startY, startHeight } = drag.current;
        onResize(clampHeight(targetRef.current, startHeight + event.clientY - startY));
    }

    function endDrag() {
        drag.current = null;
    }

    function handleKeyDown(event) {
        const box = targetRef.current;
        const current = box.getBoundingClientRect().height;
        const { min, max } = heightLimits(box);
        const next = {
            ArrowUp: current - KEY_STEP,
            ArrowDown: current + KEY_STEP,
            Home: min,
            End: max,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onResize(clampHeight(box, next));
    }

    return (
        <div
            className={className}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize the names list"
            aria-valuenow={value ? Math.round(value) : undefined}
            tabIndex={0}
            title="Drag to resize the list. Double-click to reset."
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={onReset}
            onKeyDown={handleKeyDown}
        >
            <span aria-hidden="true" />
        </div>
    );
}
