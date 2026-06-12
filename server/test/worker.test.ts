import * as mediasoup from "mediasoup";
import delay from "./delay";

it("worker", async () => {
    const worker = await mediasoup.createWorker({
        logLevel: "debug",
        logTags: ["info"],
        rtcMinPort: Number(40000),
        rtcMaxPort: Number(49999),
    });

    worker.on('died', () => {
        console.error('mediasoup Worker died, pid:', worker.pid);
    });

    await delay(2000);

    worker.close();
});

