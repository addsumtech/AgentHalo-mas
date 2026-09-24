"""Chunky mascot silhouettes for original MAS companions."""


def style_for(kind: str) -> str:
    if kind == "idle":
        return """
    @keyframes breathe { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-0.35px)} }
    @keyframes blink { 0%,92%,100%{transform:scaleY(1)} 95%{transform:scaleY(0.12)} }
    #body-js { animation: breathe 3.2s ease-in-out infinite; }
    #eyes-js { transform-origin: 7.5px 4px; animation: blink 4.4s ease-in-out infinite; }
"""
    if kind == "thinking":
        return """
    @keyframes bob { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-0.5px)} }
    @keyframes float { 0%,100%{opacity:.35;transform:translateY(0)} 50%{opacity:1;transform:translateY(-1.4px)} }
    #body-js { animation: bob 2.4s ease-in-out infinite; }
    .spark { animation: float 1.6s ease-in-out infinite; }
"""
    if kind == "working":
        return """
    @keyframes tap { 0%,100%{transform:translateY(0)} 50%{transform:translateY(0.35px)} }
    @keyframes dots { 0%,80%,100%{opacity:.2} 40%{opacity:1} }
    #body-js { animation: tap 0.7s ease-in-out infinite; }
    .d1 { animation: dots 1.2s ease-in-out infinite; }
    .d2 { animation: dots 1.2s ease-in-out .2s infinite; }
    .d3 { animation: dots 1.2s ease-in-out .4s infinite; }
"""
    if kind == "attention":
        return """
    @keyframes hop { 0%,100%{transform:translateY(0)} 40%{transform:translateY(-1.5px)} }
    #body-js { animation: hop 1.1s ease-in-out infinite; }
"""
    return ""


def extras(char: dict, kind: str) -> str:
    if kind == "thinking":
        return (
            f'<circle class="spark" cx="16.8" cy="-3.2" r="0.7" fill="{char["accent"]}"/>'
            f'<circle class="spark" cx="18.6" cy="-6" r="0.4" fill="{char["stroke"]}"/>'
        )
    if kind == "working":
        return (
            f'<circle class="d1" cx="17.4" cy="1.2" r="0.5" fill="{char["eye"]}"/>'
            f'<circle class="d2" cx="19" cy="1.2" r="0.5" fill="{char["eye"]}"/>'
            f'<circle class="d3" cx="20.6" cy="1.2" r="0.5" fill="{char["eye"]}"/>'
        )
    return ""


def shade(cx: float, cy: float, rx: float, ry: float, color: str, opacity: float = 0.16) -> str:
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{color}" opacity="{opacity}"/>'


def blush(cx1: float, cx2: float, cy: float, color: str = "#f2b8a8") -> str:
    return (
        f'<ellipse cx="{cx1}" cy="{cy}" rx="0.85" ry="0.45" fill="{color}" opacity="0.55"/>'
        f'<ellipse cx="{cx2}" cy="{cy}" rx="0.85" ry="0.45" fill="{color}" opacity="0.55"/>'
    )


def limb(x: float, y: float, w: float, h: float, fill: str) -> str:
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{min(w, h) / 2:.2f}" fill="{fill}"/>'


def smile(cx: float, cy: float, color: str, wide: float = 1.5) -> str:
    return (
        f'<path d="M{cx - wide:.1f} {cy:.1f} q{wide:.1f} 1.15 {wide * 2:.1f} 0" '
        f'fill="none" stroke="{color}" stroke-width="0.45" stroke-linecap="round"/>'
    )


def eyes(char: dict, kind: str, cx1: float, cy: float, cx2: float, r: float = 0.95) -> str:
    color = char["eye"]
    if kind == "attention":
        return (
            f'<path d="M{cx1 - 1.05:.1f} {cy:.1f} q1.05 1.1 2.1 0" fill="none" stroke="{color}" stroke-width="0.7" stroke-linecap="round"/>'
            f'<path d="M{cx2 - 1.05:.1f} {cy:.1f} q1.05 1.1 2.1 0" fill="none" stroke="{color}" stroke-width="0.7" stroke-linecap="round"/>'
        )
    if kind == "sleeping":
        return (
            f'<path d="M{cx1 - 1.1:.1f} {cy:.1f} q1.2 0.7 2.3 0" fill="none" stroke="{color}" stroke-width="0.6" stroke-linecap="round"/>'
            f'<path d="M{cx2 - 1.1:.1f} {cy:.1f} q1.2 0.7 2.3 0" fill="none" stroke="{color}" stroke-width="0.6" stroke-linecap="round"/>'
        )
    highlight = "#fff8ee" if char["id"] != "ink" else "#9a9aa0"
    if char["id"] == "owl":
        glass = "#fff6df"
        return (
            f'<circle cx="{cx1}" cy="{cy}" r="{r + 1.7}" fill="{glass}" stroke="{color}" stroke-width="0.55"/>'
            f'<circle cx="{cx2}" cy="{cy}" r="{r + 1.7}" fill="{glass}" stroke="{color}" stroke-width="0.55"/>'
            f'<path d="M{cx1 + r + 1.45:.1f} {cy:.1f} H{cx2 - r - 1.45:.1f}" stroke="{color}" stroke-width="0.5"/>'
            f'<circle cx="{cx1}" cy="{cy}" r="{r - 0.05}" fill="{color}"/>'
            f'<circle cx="{cx2}" cy="{cy}" r="{r - 0.05}" fill="{color}"/>'
            f'<circle cx="{cx1 + 0.28}" cy="{cy - 0.28}" r="{r * 0.22}" fill="#fff8ee"/>'
            f'<circle cx="{cx2 + 0.28}" cy="{cy - 0.28}" r="{r * 0.22}" fill="#fff8ee"/>'
        )
    return (
        f'<circle cx="{cx1}" cy="{cy}" r="{r}" fill="{color}"/>'
        f'<circle cx="{cx2}" cy="{cy}" r="{r}" fill="{color}"/>'
        f'<circle cx="{cx1 + 0.3}" cy="{cy - 0.28}" r="{r * 0.26}" fill="{highlight}"/>'
        f'<circle cx="{cx2 + 0.3}" cy="{cy - 0.28}" r="{r * 0.26}" fill="{highlight}"/>'
    )


def body_and_eyes(char: dict, kind: str) -> tuple[str, str]:
    cid = char["id"]
    b, s, a, f = char["body"], char["stroke"], char["accent"], char["feet"]
    sleep = kind == "sleeping"
    mouth = "" if sleep else smile(7.5, 6.6, s)

    if cid == "halo":
        body = (
            f'<ellipse cx="7.5" cy="-8.4" rx="5.6" ry="1.7" fill="none" stroke="#e0b13a" stroke-width="1.2"/>'
            f'{limb(-1.1, 7.6, 3.4, 2.1, b)}{limb(12.7, 7.6, 3.4, 2.1, b)}'
            f'{limb(3.4, 14.4, 2.3, 2.0, f)}{limb(9.3, 14.4, 2.3, 2.0, f)}'
            f'<ellipse cx="7.5" cy="6.2" rx="7.0" ry="8.0" fill="{b}"/>'
            f'{shade(7.5, 10.6, 5.2, 2.8, s)}'
            f'<path d="M2.4 8.0 C5.0 12.2, 10.0 12.2, 12.6 8.0 L12.0 12.2 C10.0 14.6, 5.0 14.6, 3.0 12.2 Z" fill="{a}"/>'
            f'{blush(4.4, 10.6, 7.4)}'
            f'{"" if sleep else smile(7.5, 7.8, s)}'
        )
        return body, eyes(char, kind, 5.2, 4.6, 9.8, 0.9)

    if cid == "sprout":
        body = (
            f'<rect x="7.1" y="-8.6" width="0.85" height="4.4" rx="0.4" fill="{s}"/>'
            f'<path d="M7.3 -7.6 C3.4 -11.6, 1.2 -6.2, 5.6 -4.4 C6.6 -5.6, 7.1 -6.6, 7.3 -7.6 Z" fill="{a}"/>'
            f'<path d="M7.8 -8.0 C12.0 -12.2, 14.0 -6.6, 9.6 -4.8 C8.6 -6.0, 8.1 -7.0, 7.8 -8.0 Z" fill="{b}"/>'
            f'{limb(-0.6, 8.8, 3.2, 2.0, b)}{limb(12.4, 8.8, 3.2, 2.0, b)}'
            f'<ellipse cx="7.5" cy="12.4" rx="4.2" ry="3.4" fill="{f}"/>'
            f'<circle cx="7.5" cy="4.2" r="5.6" fill="{b}"/>'
            f'{shade(7.5, 7.2, 4.0, 2.0, s)}'
            f'{blush(4.6, 10.4, 6.0, "#d7e8a8")}'
            f'{"" if sleep else smile(7.5, 6.4, s, 1.3)}'
        )
        return body, eyes(char, kind, 5.4, 3.6, 9.6, 0.85)

    if cid == "persimmon":
        body = (
            f'<path d="M7.5 -3.2 L4.6 -7.6 L7.5 -6.0 L10.4 -7.6 Z" fill="{a}"/>'
            f'<path d="M7.5 -3.2 L2.8 -6.2 L6.0 -5.2 Z" fill="{a}"/>'
            f'<path d="M7.5 -3.2 L12.2 -6.2 L9.0 -5.2 Z" fill="{a}"/>'
            f'<rect x="7.15" y="-5.2" width="0.7" height="2.0" rx="0.3" fill="{a}"/>'
            f'{limb(3.2, 14.4, 2.4, 1.8, f)}{limb(9.4, 14.4, 2.4, 1.8, f)}'
            f'<circle cx="7.5" cy="6.4" r="7.6" fill="{b}"/>'
            f'{shade(7.5, 10.8, 5.4, 2.6, s)}'
            f'{blush(4.4, 10.6, 8.4)}'
            f'{"" if sleep else smile(7.5, 8.8, s)}'
        )
        return body, eyes(char, kind, 5.0, 5.2, 10.0)

    if cid == "ink":
        body = (
            f'{limb(-1.4, 8.2, 3.4, 2.1, b)}{limb(13.0, 8.2, 3.4, 2.1, b)}'
            f'<path d="M2.0 2.4 C3.2 -5.6, 11.8 -6.2, 13.6 1.6 C16.4 3.4, 15.8 10.8, 12.2 13.8 C9.8 16.4, 4.4 16.2, 2.2 13.4 C-0.8 10.6, -0.4 5.2, 2.0 2.4 Z" fill="{b}"/>'
            f'{shade(7.2, 10.8, 5.0, 2.4, "#000")}'
            f'<ellipse cx="5.0" cy="1.6" rx="1.7" ry="2.6" fill="#5c5c62" opacity="0.55"/>'
            f'{"" if sleep else smile(7.5, 7.4, "#d8d6d0", 1.4)}'
        )
        return body, eyes(char, kind, 5.2, 4.6, 10.0, 0.95)

    if cid == "crescent":
        body = (
            f'{limb(3.4, 14.8, 2.3, 1.7, f)}{limb(8.2, 14.8, 2.3, 1.7, f)}'
            f'<path d="M13.2 -7.2 C1.2 -8.4, -3.6 5.2, 13.2 17.4 C6.0 12.6, 6.0 -2.4, 13.2 -7.2 Z" fill="{b}" stroke="{s}" stroke-width="0.4" stroke-linejoin="round"/>'
            f'{shade(5.6, 11.2, 2.4, 2.6, s, 0.18)}'
            f'{blush(4.6, 8.0, 7.6, "#f3d48a")}'
            f'{"" if sleep else smile(6.4, 8.2, s, 1.15)}'
        )
        return body, eyes(char, kind, 4.8, 4.8, 8.2, 0.88)

    if cid == "teapot":
        body = (
            f'<path d="M14.0 5.0 C18.0 3.2, 18.8 9.6, 14.2 10.4" fill="none" stroke="{s}" stroke-width="1.35" stroke-linecap="round"/>'
            f'<path d="M1.0 5.8 C-2.0 3.6, -1.6 11.2, 1.4 10.0" fill="none" stroke="{s}" stroke-width="1.15" stroke-linecap="round"/>'
            f'<rect x="4.8" y="-1.6" width="5.4" height="2.4" rx="0.9" fill="{f}"/>'
            f'<circle cx="7.5" cy="-2.6" r="0.95" fill="{a}"/>'
            f'{limb(3.4, 14.2, 2.3, 1.8, f)}{limb(9.3, 14.2, 2.3, 1.8, f)}'
            f'<ellipse cx="7.5" cy="7.2" rx="6.6" ry="6.4" fill="{b}"/>'
            f'{shade(7.5, 11.0, 4.8, 2.2, s)}'
            f'{blush(4.8, 10.2, 8.6, "#d7c4a3")}'
            f'{"" if sleep else smile(7.5, 9.0, s, 1.35)}'
        )
        return body, eyes(char, kind, 5.4, 6.2, 9.6, 0.88)

    if cid == "crane":
        body = (
            f'<path d="M7.5 1.6 L-1.4 9.2 L7.5 6.8 L16.4 9.2 Z" fill="{b}" stroke="{s}" stroke-width="0.35" stroke-linejoin="round"/>'
            f'<path d="M7.5 1.6 L3.0 -5.4 L7.5 -1.8 Z" fill="{a}" stroke="{s}" stroke-width="0.3" stroke-linejoin="round"/>'
            f'<path d="M7.5 1.6 L12.0 -5.4 L7.5 -1.8 Z" fill="{b}" stroke="{s}" stroke-width="0.3" stroke-linejoin="round"/>'
            f'<path d="M7.5 6.8 L5.4 15.4 L7.5 12.6 L9.6 15.4 Z" fill="{a}" stroke="{s}" stroke-width="0.3" stroke-linejoin="round"/>'
            f'<path d="M3.0 -5.2 L-0.4 -8.0 L3.8 -6.0 Z" fill="#e0b13a"/>'
            f'{limb(4.6, 14.8, 1.8, 1.6, f)}{limb(8.6, 14.8, 1.8, 1.6, f)}'
            f'{"" if sleep else smile(7.5, 4.6, s, 1.05)}'
        )
        return body, eyes(char, kind, 5.8, 2.6, 9.2, 0.72)

    if cid == "nimbus":
        drops = "" if sleep else (
            f'<ellipse cx="4.6" cy="16.2" rx="0.5" ry="0.9" fill="{a}"/>'
            f'<ellipse cx="7.5" cy="17.6" rx="0.45" ry="0.85" fill="{a}"/>'
            f'<ellipse cx="10.4" cy="16.2" rx="0.5" ry="0.9" fill="{a}"/>'
        )
        body = (
            f'{limb(-1.2, 8.4, 3.3, 2.0, b)}{limb(12.9, 8.4, 3.3, 2.0, b)}'
            f'<ellipse cx="3.0" cy="6.4" rx="4.2" ry="3.6" fill="{b}"/>'
            f'<ellipse cx="12.0" cy="6.6" rx="4.4" ry="3.7" fill="{b}"/>'
            f'<ellipse cx="7.5" cy="3.8" rx="5.6" ry="4.6" fill="{b}"/>'
            f'{shade(7.5, 8.6, 5.8, 2.2, s, 0.14)}'
            f'{blush(5.0, 10.0, 6.4, "#c8d8ea")}'
            f'{"" if sleep else smile(7.5, 6.8, s, 1.35)}'
            + drops
        )
        return body, eyes(char, kind, 5.4, 3.8, 9.6, 0.88)

    if cid == "lantern":
        body = (
            f'<path d="M4.8 -5.6 C4.8 -8.8, 10.2 -8.8, 10.2 -5.6" fill="none" stroke="{a}" stroke-width="0.95" stroke-linecap="round"/>'
            f'<rect x="3.6" y="-5.0" width="7.8" height="1.5" rx="0.5" fill="{a}"/>'
            f'{limb(3.6, 14.4, 2.2, 1.7, a)}{limb(9.2, 14.4, 2.2, 1.7, a)}'
            f'<ellipse cx="7.5" cy="5.8" rx="6.0" ry="7.8" fill="{b}"/>'
            f'<rect x="3.8" y="12.8" width="7.4" height="1.3" rx="0.45" fill="{a}"/>'
            f'<path d="M7.5 14.1 L7.5 17.4" stroke="{a}" stroke-width="0.7" stroke-linecap="round"/>'
            f'<circle cx="7.5" cy="18.0" r="0.7" fill="{a}"/>'
            f'{shade(7.5, 10.4, 4.2, 2.4, s)}'
            f'{blush(4.8, 10.2, 7.8)}'
            f'{"" if sleep else smile(7.5, 8.2, s)}'
        )
        return body, eyes(char, kind, 5.3, 4.4, 9.7, 0.88)

    if cid == "cactus":
        body = (
            f'{limb(-1.6, 3.6, 5.4, 3.0, b)}{limb(11.2, 1.6, 5.2, 2.8, b)}'
            f'{limb(3.6, 14.6, 2.2, 1.7, f)}{limb(9.2, 14.6, 2.2, 1.7, f)}'
            f'<rect x="4.6" y="-3.4" width="5.8" height="18.2" rx="2.9" fill="{b}"/>'
            f'<circle cx="7.5" cy="-4.6" r="1.15" fill="{a}"/>'
            f'{shade(7.5, 10.8, 2.2, 3.4, s, 0.18)}'
            f'{blush(5.8, 9.2, 6.2, "#d7e8a8")}'
            f'{"" if sleep else smile(7.5, 6.6, s, 1.05)}'
        )
        return body, eyes(char, kind, 6.1, 3.2, 8.9, 0.78)

    if cid == "bao":
        body = (
            f'{limb(-0.8, 8.6, 3.2, 2.0, b)}{limb(12.6, 8.6, 3.2, 2.0, b)}'
            f'<ellipse cx="7.5" cy="7.0" rx="8.8" ry="7.4" fill="{b}"/>'
            f'<path d="M2.2 1.8 Q7.5 -3.0 12.8 1.8" fill="none" stroke="{a}" stroke-width="0.55"/>'
            f'<path d="M3.2 3.2 Q7.5 -0.2 11.8 3.2" fill="none" stroke="{a}" stroke-width="0.45"/>'
            f'<path d="M4.0 4.4 Q7.5 2.0 11.0 4.4" fill="none" stroke="{a}" stroke-width="0.4"/>'
            f'{shade(7.5, 11.4, 6.2, 2.4, s, 0.14)}'
            f'{blush(4.2, 10.8, 8.6)}'
            f'{"" if sleep else smile(7.5, 8.8, s, 1.55)}'
        )
        return body, eyes(char, kind, 4.8, 6.4, 10.2, 0.95)

    if cid == "starfish":
        body = (
            f'<path d="M7.5 -7.2 L9.2 2.4 L17.6 3.6 L11.2 8.8 L13.0 17.0 L7.5 12.4 L2.0 17.0 L3.8 8.8 L-2.6 3.6 L5.8 2.4 Z" fill="{b}" stroke-linejoin="round"/>'
            f'{shade(7.5, 9.4, 3.6, 2.2, s, 0.18)}'
            f'{blush(5.2, 9.8, 7.6)}'
            f'{"" if sleep else smile(7.5, 8.0, s, 1.2)}'
        )
        return body, eyes(char, kind, 5.5, 5.6, 9.5, 0.88)

    if cid == "turtle":
        body = (
            f'<ellipse cx="1.2" cy="11.8" rx="2.0" ry="1.25" fill="{f}"/>'
            f'<ellipse cx="13.8" cy="11.8" rx="2.0" ry="1.25" fill="{f}"/>'
            f'<ellipse cx="1.8" cy="5.0" rx="1.8" ry="1.2" fill="{f}"/>'
            f'<ellipse cx="13.2" cy="5.0" rx="1.8" ry="1.2" fill="{f}"/>'
            f'<ellipse cx="7.5" cy="7.6" rx="8.2" ry="6.2" fill="{a}"/>'
            f'<path d="M3.8 5.0 L7.5 3.2 L11.2 5.0 L11.2 9.6 L7.5 11.4 L3.8 9.6 Z" fill="{b}" opacity="0.7"/>'
            f'<circle cx="7.5" cy="-0.4" r="3.15" fill="{b}"/>'
            f'{shade(7.5, 10.8, 6.0, 2.0, s, 0.16)}'
            f'{"" if sleep else smile(7.5, 0.9, s, 0.9)}'
        )
        return body, eyes(char, kind, 6.3, -1.0, 8.7, 0.52)

    if cid == "fox":
        body = (
            f'<path d="M15.8 4.0 C19.6 0.8, 20.6 9.6, 15.0 12.2 C13.4 9.0, 14.2 5.6, 15.8 4.0 Z" fill="{b}"/>'
            f'<ellipse cx="7.4" cy="9.4" rx="5.6" ry="5.2" fill="{b}"/>'
            f'{limb(3.4, 14.2, 2.2, 1.8, f)}{limb(9.0, 14.2, 2.2, 1.8, f)}'
            f'<circle cx="7.4" cy="3.8" r="5.3" fill="{b}"/>'
            f'<path d="M2.2 -0.6 L3.8 -6.8 L6.4 0.2 Z" fill="{b}"/>'
            f'<path d="M12.6 -0.6 L11.0 -6.8 L8.4 0.2 Z" fill="{b}"/>'
            f'<path d="M3.6 -1.4 L4.2 -4.4 L5.6 0.0 Z" fill="{a}"/>'
            f'<path d="M11.2 -1.4 L10.6 -4.4 L9.2 0.0 Z" fill="{a}"/>'
            f'<ellipse cx="7.4" cy="6.0" rx="2.3" ry="1.6" fill="{a}"/>'
            f'<path d="M7.4 9.6 L4.2 12.8 L10.6 12.8 Z" fill="{a}"/>'
            f'{"" if sleep else smile(7.4, 6.8, s, 1.15)}'
        )
        return body, eyes(char, kind, 5.4, 3.2, 9.4, 0.82)

    if cid == "owl":
        body = (
            f'<path d="M2.4 -3.2 L4.8 -8.0 L6.6 -2.4 Z" fill="{s}"/>'
            f'<path d="M12.6 -3.2 L10.2 -8.0 L8.4 -2.4 Z" fill="{s}"/>'
            f'{limb(3.2, 14.4, 2.4, 1.7, f)}{limb(9.4, 14.4, 2.4, 1.7, f)}'
            f'<ellipse cx="7.5" cy="6.4" rx="7.2" ry="8.2" fill="{b}"/>'
            f'{shade(7.5, 11.4, 5.2, 2.4, s)}'
            f'{"" if sleep else smile(7.5, 8.4, s, 1.2)}'
        )
        return body, eyes(char, kind, 5.0, 3.6, 10.0, 0.82)

    if cid == "acorn":
        body = (
            f'<rect x="7.1" y="-8.8" width="0.8" height="2.6" rx="0.3" fill="{a}"/>'
            f'<path d="M0.6 -1.2 C1.8 -7.0, 13.2 -7.0, 14.4 -1.2 Z" fill="{a}"/>'
            f'{limb(3.6, 14.6, 2.2, 1.7, f)}{limb(9.2, 14.6, 2.2, 1.7, f)}'
            f'<ellipse cx="7.5" cy="8.0" rx="6.4" ry="7.0" fill="{b}"/>'
            f'<path d="M2.4 6.6 Q7.5 9.6 12.6 6.6" fill="none" stroke="{s}" stroke-width="0.32" opacity="0.45"/>'
            f'{shade(7.5, 11.8, 4.6, 2.2, s)}'
            f'{blush(4.8, 10.2, 9.4)}'
            f'{"" if sleep else smile(7.5, 9.6, s, 1.25)}'
        )
        return body, eyes(char, kind, 5.2, 6.8, 9.8, 0.88)

    if cid == "snow":
        body = (
            f'<path d="M1.4 9.2 L-3.4 6.6" stroke="#8b5a2b" stroke-width="0.9" stroke-linecap="round"/>'
            f'<path d="M13.6 9.2 L18.4 6.6" stroke="#8b5a2b" stroke-width="0.9" stroke-linecap="round"/>'
            f'<circle cx="7.5" cy="11.0" r="6.2" fill="{b}"/>'
            f'<circle cx="7.5" cy="1.8" r="4.5" fill="{b}"/>'
            f'<circle cx="7.5" cy="8.2" r="0.42" fill="{char["eye"]}"/>'
            f'<circle cx="7.5" cy="10.6" r="0.42" fill="{char["eye"]}"/>'
            f'<circle cx="7.5" cy="13.0" r="0.42" fill="{char["eye"]}"/>'
            f'<circle cx="5.8" cy="3.8" r="0.42" fill="{a}"/>'
            f'<circle cx="9.2" cy="3.8" r="0.42" fill="{a}"/>'
            f'{shade(7.5, 14.2, 4.4, 1.8, s, 0.14)}'
            f'{"" if sleep else smile(7.5, 3.6, s, 1.0)}'
        )
        return body, eyes(char, kind, 5.9, 1.2, 9.1, 0.68)

    body = f'<ellipse cx="7.5" cy="5" rx="7" ry="8" fill="{b}"/>'
    return body, eyes(char, kind, 5.1, 3.5, 9.9) + mouth


def svg_for(char: dict, kind: str) -> str:
    body, eye = body_and_eyes(char, kind)
    extra = extras(char, kind)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15 -25 45 45">
  <style>{style_for(kind)}
  </style>
  <g id="shadow-js" style="transform-origin: 7.5px 15px">
    <ellipse cx="7.5" cy="17.0" rx="6.4" ry="1.35" fill="rgba(47,32,18,0.15)"/>
  </g>
  <g id="body-js">
    {body}
    {extra}
  </g>
  <g id="eyes-js">
    {eye}
  </g>
</svg>
"""
