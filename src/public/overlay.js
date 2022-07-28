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

function shoutOut(args) {
    // step 1: create the DOM elements for the shoutout in the #shoutOutOverlay DIV
    // TODO: the first DIV below probably needs to default to "left: -500px" to keep it
    //       off-screen on initialization
    $('#shoutOutOverlay').append(`
        <div class="absolute left-[0px] top-[100px] min-w-fit max-w-full">
            <div class="z-10 absolute bg-white ml-[50px] min-w-fit max-w-full">
                <iframe
                    class="border-amber-400 border-4"
                    src="https://clips.twitch.tv/embed?clip=FineFunnyFoxUncleNox-NQAo-Lr8jTtN6aRb&parent=localhost&parent=kogasa.t0xic.local&preload=auto&autoplay=true"
                    height="180"
                    width="320"
                ></iframe>
                <img class="relative left-[-30px] top-[-212px] border-amber-400 bg-white border-4 rounded-full w-[64px] h-[64px]" src="https://static-cdn.jtvnw.net/jtv_user_pictures/59956779-f23b-4c9b-95e7-3cf211488815-profile_image-70x70.png"> 
            </div>
            <div class="z-0 absolute top-[130px] bg-amber-400 rounded-r-full font-bold text-lg pl-[395px] pr-4 min-w-fit max-w-full whitespace-nowrap">Go follow vtemp1ar!</div>
        </div>
    `);
    // step 2: do the thing to animate the slide-in of the shoutout element we just created

    // step 3: wait until the clip is done playing.  We know how long that'll take
    // because the Twitch API tells us in its result data.

    // step 4: do the thing to animate the slide-out of the shoutout element blah blah blah

    // step 5: delete the shoutout element from the DOM
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
        socket.on("shoutout", (args) => {
            // TODO: pass args to shoutOut() to make the magic happen
        })
    })
});