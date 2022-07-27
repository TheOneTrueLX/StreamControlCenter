var socket = io();

const align = document.getElementById('overlay').getAttribute('data-align');
const nofade = document.getElementById('overlay').getAttribute('data-nofade');

function leftAlignedChat(args) {
    $("#chatContainer").append(`
        <div id="chatMsg" class="${nofade == "true" ? 'fade-in ' : 'fade '}ml-4 mt-4 w-fit grid grid-cols-1 justify-items-start">
            <div class="rounded-full bg-amber-300 px-2 py-0 w-fit flex justify-center items-center">
                <img class="rounded-full inline-block w-[16px] h-[16px]" src="${args.profile}">&nbsp;<div class="inline-block text-black font-bold text-sm">${args.user}</div>
            </div>
            <div class="ml-8 border rounded-lg rounded-tl-none border-amber-300 bg-white opacity-50 px-4 py-1 w-fit max-w-md text-sm">${args.message}</div>
        </div>    
    `);
}

function rightAlignedChat(args) { 
    $("#chatContainer").append(`
        <div id="chatMsg" class="${nofade == "true" ? 'fade-in ' : 'fade '}mr-4 mt-4 w-fit grid grid-cols-1 justify-items-end">
            <div class="rounded-full bg-amber-300 px-2 py-0 w-fit flex justify-center items-center">
                <img class="rounded-full inline-block w-[16px] h-[16px]" src="${args.profile}">&nbsp;<div class="inline-block text-black font-bold text-sm">${args.user}</div>
            </div>
            <div class="mr-8 border rounded-lg rounded-tr-none border-amber-300 bg-white opacity-50 px-4 py-1 w-fit max-w-md text-sm">${args.message}</div>
        </div>    
    `);
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
        // do something with the shoutout
    })
});