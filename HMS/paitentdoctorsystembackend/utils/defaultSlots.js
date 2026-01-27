const DAYS_AHEAD = 365;

const TIMES = [
    "10:00 AM",
    "02:00 PM",
    "05:00 PM",
    "10:00",
    "14:00",
    "17:00",
];

function dateKey(d) {
    return `${d.getDate()}_${d.getMonth() + 1}_${d.getFullYear()}`;
}

export function generateDefaultSlots() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const slots = {};

    for (let i = 0; i < DAYS_AHEAD; i++) {
        const dt = new Date(today);
        dt.setDate(today.getDate() + i);
        const key = dateKey(dt);
        slots[key] = [...TIMES];
    }

    return slots;
}
