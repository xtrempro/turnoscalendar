// calculations.js

export function isWeekend(d){
    return [0,6].includes(d.getDay());
}

export function isBusinessDay(d,h){
    return !isWeekend(d) &&
    !h[`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`];
}

export function calcNight(date,h){
    const dow=date.getDay();
    const isHab=isBusinessDay(date,h);

    const next=new Date(date);
    next.setDate(date.getDate()+1);
    const nextHab=isBusinessDay(next,h);

    if(dow===1) return isHab&&nextHab?{d:2,n:10}:{d:1,n:11};

    if([2,3,4].includes(dow)){
        if(isHab&&nextHab) return {d:2,n:10};
        if(isHab&&!nextHab) return {d:1,n:11};
        if(!isHab&&nextHab) return {d:1,n:11};
        return {d:0,n:12};
    }

    if(dow===5) return isHab?{d:1,n:11}:{d:0,n:12};
    if(dow===6) return {d:0,n:12};
    if(dow===0) return nextHab?{d:1,n:11}:{d:0,n:12};
}

export function calc24(date,h){
    const dow=date.getDay();
    const isHab=isBusinessDay(date,h);

    const next=new Date(date);
    next.setDate(date.getDate()+1);
    const nextHab=isBusinessDay(next,h);

    if(dow===1){
        if(isHab&&nextHab) return {d:14,n:10};
        if(isHab&&!nextHab) return {d:13,n:11};
        if(!isHab&&nextHab) return {d:1,n:23};
        return {d:0,n:24};
    }

    if([2,3,4].includes(dow)){
        if(isHab&&nextHab) return {d:14,n:10};
        if(isHab&&!nextHab) return {d:13,n:11};
        if(!isHab&&nextHab) return {d:1,n:23};
        return {d:0,n:24};
    }

    if(dow===5) return isHab?{d:13,n:11}:{d:0,n:24};
    if(dow===6) return {d:0,n:24};
    if(dow===0) return nextHab?{d:1,n:23}:{d:0,n:24};
}

export function calcDiurno(date,h={}){
    if(!isBusinessDay(date,h)) return {d:0,n:0};

    const d=date.getDay();

    if([1,2,3,4,5].includes(d)) return {d:8.8,n:0};

    return {d:0,n:0};
}

export function calcDiaNoche(date,h){
    const diurno=calcDiurno(date,h);
    const noche=calcNight(date,h);

    return {
        d:diurno.d+noche.d,
        n:noche.n
    };
}

export function calcMediaManana(date,h={}){
    return isBusinessDay(date,h)
        ? {d:6,n:0}
        : {d:0,n:6};
}

export function calcMediaTarde(date,h={}){
    return isBusinessDay(date,h)
        ? {d:6,n:0}
        : {d:0,n:6};
}

export function calc18(date,h={}){
    const tarde = calcMediaTarde(date,h);
    const noche = calcNight(date,h);

    return {
        d: tarde.d + noche.d,
        n: tarde.n + noche.n
    };
}

export function calcHours(date,state,h){
    if(state===0) return {d:0,n:0};

    if(state===1)
        return isBusinessDay(date,h)?{d:12,n:0}:{d:0,n:12};

    if(state===2) return calcNight(date,h);
    if(state===3) return calc24(date,h);
    if(state===4) return calcDiurno(date,h);
    if(state===5) return calcDiaNoche(date,h);
    if(state===6) return calcMediaManana(date,h);
    if(state===7) return calcMediaTarde(date,h);
    if(state===8) return calc18(date,h);

    return {d:0,n:0};
}

// Cálculo puro de una celda. workerId forma parte de la API para que los
// consumidores mantengan explícito qué trabajador están actualizando.
export function calculateDayHours(workerId, date, state, holidays = {}) {
    void workerId;
    return calcHours(date, state, holidays);
}

export function calcCarry(lastDate,state,h){
    if(![2,3,5,8].includes(state)) return {d:0,n:0};

    const isHab=isBusinessDay(lastDate,h);

    const next=new Date(lastDate);
    next.setDate(lastDate.getDate()+1);
    const nextHab=isBusinessDay(next,h);

    if((isHab&&nextHab)||(!isHab&&nextHab))
        return {d:1,n:7};

    return {d:0,n:8};
}
