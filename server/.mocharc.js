module.exports = {
    require: [
        'ts-node/register',
    ],
    timeout: 10000,
    exit: true,
    spec: [
        './test/**/*.test.ts'
    ],
}