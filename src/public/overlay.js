var socket = io();

const align = document.getElementById('overlay').getAttribute('data-align');
const nofade = document.getElementById('overlay').getAttribute('data-nofade');

function leftAlignedChat(args) {
    $("#chatContainer").append(`
        <div id="chatMsg" class="${nofade == "true" ? 'fade-in ' : 'fade '}ml-4 mt-4 w-fit grid grid-cols-1 justify-items-start">
            <div class="relative z-10 rounded-full bg-[${args.bg_color}] px-2 py-0 w-fit flex justify-center items-center">
                <img class="rounded-full inline-block w-[16px] h-[16px]" src="${args.profile}">&nbsp;<div class="inline-block text-[${args.fg_color}] font-bold text-sm">${args.user}</div>
            </div>
            <div class="relative z-0 top-[-6px] ml-8 border rounded-lg rounded-tl-none border-[${args.bg_color}] bg-white bg-opacity-25 px-4 py-1 w-fit max-w-md font-semibold text-white text-sm">${args.message}</div>
        </div>    
    `);
}

function rightAlignedChat(args) { 
    $("#chatContainer").append(`
        <div id="chatMsg" class="${nofade == "true" ? 'fade-in ' : 'fade '}mr-4 mt-4 w-fit grid grid-cols-1 justify-items-end">
            <div class="relative z-10 rounded-full bg-[${args.bg_color}] px-2 py-0 w-fit flex justify-center items-center">
                <img class="rounded-full inline-block w-[16px] h-[16px]" src="${args.profile}">&nbsp;<div class="inline-block text-[${args.fg_color}] font-bold text-sm">${args.user}</div>
            </div>
            <div class="relative z-0 top-[-6px] mr-8 border rounded-lg rounded-tr-none border-[${args.bg_color}] bg-white bg-opacity-25 px-4 py-1 w-fit max-w-md font-semibold text-white text-sm">${args.message}</div>
        </div>    
    `);
}

function shoutOut(args) {
    // TODO: figure out a way to queue these up in case there are multiple shoutouts fired.
    //       Right now, they'll just stack, which could be hilariously scuffed.
    $("#shoutOutOverlay").append(`
        <div class="slide absolute left-[-1000px] top-[100px] min-w-fit max-w-full" style="--duration: ${args.duration + 2}s">
            <div class="z-10 absolute bg-transparent ml-[50px] min-w-fit max-w-full">
                <iframe
                    class="border-amber-400 border-4"
                    src="${args.embed_url}&parent=localhost&parent=kogasa.t0xic.local&preload=auto&autoplay=true"
                    height="180"
                    width="320"
                ></iframe>
                <img class="relative left-[-30px] top-[-212px] border-amber-400 bg-white border-4 rounded-full w-[64px] h-[64px]" src="${args.profile_img}"> 
            </div>
            <div class="z-0 absolute top-[130px] bg-amber-400 rounded-r-full font-bold text-lg pl-[395px] pr-4 min-w-fit max-w-full whitespace-nowrap">Go follow ${args.broadcaster}!</div>
        </div>
    `);

    setTimeout(function () { $('#shoutOutOverlay').empty() }, (Number(args.duration) * 1000) + 2500)
}


$(document).ready(function() {
    socket.on("chatMsg", (args) => {
        switch(align) {
            case 'left': 
                leftAlignedChat(args);
                break;
            case 'right':
                rightAlignedChat(args);
                break;
        }
    });

    socket.on("shoutout", (args) => {
        shoutOut(args)
    })
});