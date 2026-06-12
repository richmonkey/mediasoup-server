
export default function delay(ms:number) {
    return new Promise<void>(function(resolve, reject) {
        setTimeout(function() {
            resolve();
        }, ms);
    })
}