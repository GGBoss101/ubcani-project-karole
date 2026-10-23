"use client";

// A macOS-style scrollbar drawn over a scrolling box whose own scrollbar is hidden. Native
// scrollbars can't be animated, so this one is plain elements: a thin thumb that eases wider
// and brighter under the pointer (see the classes passed in), can be dragged, and pages the box
// when the track beside it is clicked. It also shows a soft shade along the bottom while there
// is more to scroll, gone once the end is reached. The box itself still scrolls natively.
import { useEffect, useRef, useState } from "react";

// How long the thumb stays brighter after the box stops scrolling.
const IDLE_MS = 1000;

export default function OverlayScrollbar({ targetRef, classNames }) {
    // How much of the content is in view and how far down it is scrolled, both from 0 to 1, or
    // null while everything fits and there is nothing to scroll.
    const [view, setView] = useState(null);
    const [scrolling, setScrolling] = useState(false);
    const [dragging, setDragging] = useState(false);
    const drag = useRef(null);

    useEffect(() => {
        const box = targetRef.current;
        if (!box) return undefined;
        let frame = 0;
        let idleTimer = 0;

        function measure() {
            frame = 0;
            const { scrollTop, scrollHeight, clientHeight } = box;
            if (scrollHeight <= clientHeight + 1) {
                setView(null);
                return;
            }
            const scrollRange = scrollHeight - clientHeight;
            setView({
                size: clientHeight / scrollHeight,
                position: Math.min(1, scrollTop / scrollRange),
                atEnd: scrollTop >= scrollRange - 1,
            });
        }

        function handleScroll() {
            if (!frame) frame = requestAnimationFrame(measure);
            setScrolling(true);
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => setScrolling(false), IDLE_MS);
        }

        // Fires once on observing, then whenever the box or its content (rows added, removed
        // or filtered) changes size. It already runs once per frame, so it measures directly;
        // only scrolling goes through requestAnimationFrame.
        const observer = new ResizeObserver(measure);
        observer.observe(box);
        for (const child of box.children) observer.observe(child);
        box.addEventListener("scroll", handleScroll, { passive: true });
        return () => {
            observer.disconnect();
            box.removeEventListener("scroll", handleScroll);
            cancelAnimationFrame(frame);
            clearTimeout(idleTimer);
        };
    }, [targetRef]);

    if (!view) return null;

    function pageTowards(event) {
        // A click on the track beside the thumb moves the list one screen that way.
        const box = targetRef.current;
        const thumbTop = event.currentTarget.firstElementChild.getBoundingClientRect().top;
        const direction = event.clientY < thumbTop ? -1 : 1;
        box.scrollBy({ top: direction * box.clientHeight * 0.9, behavior: "smooth" });
    }

    function startDrag(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const box = targetRef.current;
        const trackHeight = event.currentTarget.parentElement.clientHeight;
        drag.current = {
            startY: event.clientY,
            startScrollTop: box.scrollTop,
            // Pixels of scrolling per pixel the thumb moves.
            ratio: (box.scrollHeight - box.clientHeight) / (trackHeight - event.currentTarget.offsetHeight),
        };
        setDragging(true);
    }

    function moveDrag(event) {
        if (!drag.current) return;
        const { startY, startScrollTop, ratio } = drag.current;
        targetRef.current.scrollTop = startScrollTop + (event.clientY - startY) * ratio;
    }

    function endDrag() {
        drag.current = null;
        setDragging(false);
    }

    const trackClass = [classNames.track, dragging && classNames.dragging, scrolling && classNames.scrolling]
        .filter(Boolean)
        .join(" ");
    // The thumb is sized and placed as a share of the track, never shorter than 2rem.
    const thumbHeight = `max(2rem, ${view.size * 100}%)`;

    return (
        <>
            <div className={`${classNames.shade} ${view.atEnd ? classNames.shadeHidden : ""}`} aria-hidden="true" />
            <div className={trackClass} onPointerDown={pageTowards} aria-hidden="true">
                <div
                    className={classNames.thumb}
                    style={{ height: thumbHeight, top: `calc((100% - ${thumbHeight}) * ${view.position})` }}
                    onPointerDown={startDrag}
                    onPointerMove={moveDrag}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                />
            </div>
        </>
    );
}
