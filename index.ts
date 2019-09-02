declare class VConsole {
    constructor()
}

(function () {
    new VConsole()

    if (typeof Promise !== 'function' || typeof AudioContext !== 'function') {
        throw new Error('Old browser version detected. Please update your browser')
    }

    const getUserMedia: (constraints: object) => Promise<any> = (
        navigator.mediaDevices
        && navigator.mediaDevices.getUserMedia
        && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    ) || (constraints => {
        const privateFunc = (navigator as any).getUserMedia
            || (navigator as any).webkitGetUserMedia
            || (navigator as any).mozGetUserMedia
            || (navigator as any).msGetUserMedia

        if (!privateFunc) {
            return Promise.reject(new Error('GetUserMedia is not supported'))
        }

        return new Promise((resolve, reject) => {
            privateFunc.call(navigator, constraints, resolve, reject)
        })
    })

    const SERVER_URL = 'https://wujiang.me/model/predict?start_time=0'
    const button = document.getElementById('audio-button')
    const BUFFER_SIZE = 4096
    const CHANNEL_COUNT = 2
    const SOUND_CHANNELS = [[], []]

    const SPEECH_LABEL = ['/m/09x0r']

    const GENDER_MALE_LABEL = ['/m/05zppz', '/t/dd00003']
    const GENDER_FEMALE_LABEL = ['/m/02zsn', '/t/dd00004']
    const GENDER_NEUTRAL_LABEL = ['/m/0ytgt', '/m/0261r1', '/t/dd00135', '/t/dd00001', '/t/dd00002', '/t/dd00005', '/t/dd00013']

    const AGE_ADULT_LABEL = ['/m/05zppz', '/m/02zsn', '/t/dd00003', '/t/dd00004']
    const AGE_NONAGE_LABEL = ['/m/0ytgt', '/m/0261r1', '/t/dd00135', '/t/dd00001', '/t/dd00002', '/t/dd00005', '/t/dd00013']

    const EMOTION_ANGER_LABEL = ['/m/07p6fty', '/m/07q4ntr', '/t/dd00135', '/m/03qc9zr', '/m/07qf0zm', '/m/0ghcn6']
    const EMOTION_EXCITED_LABEL = ['/m/07p6fty', '/m/07rwj3x', '/m/04gy_2', '/t/dd00135', '/m/03qc9zr', '/m/053hz1', '/m/028ght']
    const EMOTION_LAUGH_LABEL = ['/m/01j3sz', '/t/dd00001', '/m/07r660_', '/m/07s04w4', '/m/07sq110', '/m/07rgt08']
    const EMOTION_CRY_LABEL = ['/m/0463cq4', '/t/dd00002', '/m/07qz6j3']

    let granted = false
    let startTime = null
    let audioCtx = null
    let source = null
    let processor = null
    let msPointer = null

    window.addEventListener('contextmenu', e => {
        e.preventDefault()
    })

    const askForPermission = () => {
        getUserMedia({ audio: true }).then(ms => {
            ms.getAudioTracks()[0].stop()
            granted = true
        }).catch(console.error)
    }

    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(result => {
            if (result.state === 'granted') {
                granted = true
            } else if (result.state === 'prompt') {
                askForPermission()
            }
        }).catch(e => {
            console.error(e)
            askForPermission()
        })
    } else {
        askForPermission()
    }

    const reset = (): void => {
        if (msPointer) {
            msPointer.getAudioTracks()[0].stop()
            msPointer = null
        }
        if (source) {
            source.disconnect()
            source = null
        }
        if (processor) {
            processor.disconnect()
            processor = null
        }
        if (audioCtx) {
            audioCtx = null
        }
        if (startTime) {
            startTime = null
        }
        SOUND_CHANNELS.forEach(c => {
            c.length = 0
        })
    }

    const loading_start = () => {
        document.getElementById('loading').setAttribute('style', 'display: block')
    }

    const loading_end = () => {
        document.getElementById('loading').setAttribute('style', 'display: none')
    }

    const mergeChannel = (channel: Float32Array[]): Float32Array => {
        const length = channel.length
        const data = new Float32Array(length * BUFFER_SIZE)
        let offset = 0
        for (let i = 0; i < length; i++) {
            data.set(channel[i], offset)
            offset += BUFFER_SIZE
        }
        return data
    }

    const mergePCM = (): Float32Array => {
        const left = mergeChannel(SOUND_CHANNELS[0])
        const right = mergeChannel(SOUND_CHANNELS[1])
        const length = Math.floor(left.length / 44100) * 44100
        const data = new Float32Array(length * 2)
        for (let i = 0; i < length; i++) {
            let j = i * 2
            data[j] = left[i]
            data[j + 1] = right[i]
        }
        return data
    }

    const writeUTFBytes = (view: DataView, offset: number, string: string) => {
        const length = string.length
        for (let i = 0; i < length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i))
        }
    }

    const createFile = (audioData: Float32Array): Blob => {
        const WAV_HEAD_SIZE = 44
        const TOTAL_SIZE = audioData.length * 2 + WAV_HEAD_SIZE
        const buffer = new ArrayBuffer(TOTAL_SIZE)
        const view = new DataView(buffer)
        writeUTFBytes(view, 0, 'RIFF')
        view.setUint32(4, TOTAL_SIZE - 8, true)
        writeUTFBytes(view, 8, 'WAVE')
        writeUTFBytes(view, 12, 'fmt ')
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true)
        view.setUint16(22, 2, true)
        view.setUint32(24, 44100, true)
        view.setUint32(28, 44100 * 2 * 2, true)
        view.setUint16(32, 2 * 2, true)
        view.setUint16(34, 16, true)
        writeUTFBytes(view, 36, 'data')
        view.setUint32(40, TOTAL_SIZE - WAV_HEAD_SIZE, true)

        let index = WAV_HEAD_SIZE
        let volume = 1
        for (let i = 0, l = audioData.length; i < l; i++) {
            view.setInt16(index, audioData[i] * 32767 * volume, true)
            index += 2
        }

        return new Blob([new Uint8Array(buffer)], { type: 'audio/x-wav' })
    }

    const uploadRecord = (url: string, file: any, callback: Function, fileField: string = 'file'): void => {
        const formData = new FormData()
        formData.append(fileField, file)
        const xhr = new XMLHttpRequest()
        xhr.onreadystatechange = () => {
            if (xhr.readyState === 4) {
                callback(xhr.responseText)
            }
        }
        xhr.onerror = xhr.onabort = loading_end
        xhr.open('POST', url, true)
        // xhr.setRequestHeader('Content-Type', 'multipart/form-data')
        xhr.setRequestHeader('accept', 'application/json')
        xhr.send(formData)
    }

    const predictResultParseHandle = (result: string) => {
        try {
            const { predictions: predictResult } = JSON.parse(result)
            const sexPossibility = []
            const agePossibility = []
            const emotionPossibility = []
            const tonePossibility = []
            // let weight = predictResult.length
            let speech = false

            const probabilityToPercent = float => `(${Math.round(float * 100)}%)`

            while (predictResult.length > 0) {
                let { label_id: label, probability } = predictResult.shift()
                if (SPEECH_LABEL.indexOf(label) > -1) {
                    speech = true
                }
                if (GENDER_MALE_LABEL.indexOf(label) > -1) {
                    sexPossibility.push('男性')
                    tonePossibility.push('磁性大叔' + probabilityToPercent(probability))
                }
                if (GENDER_FEMALE_LABEL.indexOf(label) > -1) {
                    sexPossibility.push('女性')
                    tonePossibility.push('美艳御姐' + probabilityToPercent(probability))
                }
                if (GENDER_NEUTRAL_LABEL.indexOf(label) > -1) {
                    sexPossibility.push('中性')
                    tonePossibility.push('可攻可受' + probabilityToPercent(probability))
                }
                if (AGE_ADULT_LABEL.indexOf(label) > -1) {
                    agePossibility.push('成年(成熟的)')
                    tonePossibility.push('成熟稳重' + probabilityToPercent(probability))
                }
                if (AGE_NONAGE_LABEL.indexOf(label) > -1) {
                    agePossibility.push('未成年(青涩的)')
                    tonePossibility.push('萝莉正太' + probabilityToPercent(probability))
                }
                if (EMOTION_ANGER_LABEL.indexOf(label) > -1) {
                    emotionPossibility.push('(愤怒/咆哮)')
                    tonePossibility.push('金毛狮王' + probabilityToPercent(probability))
                }
                if (EMOTION_EXCITED_LABEL.indexOf(label) > -1) {
                    emotionPossibility.push('(激动/兴奋)')
                    tonePossibility.push('春光灿烂猪八戒' + probabilityToPercent(probability))
                }
                if (EMOTION_LAUGH_LABEL.indexOf(label) > -1) {
                    emotionPossibility.push('(开心/笑声)')
                    tonePossibility.push('快乐逗比' + probabilityToPercent(probability))
                }
                if (EMOTION_CRY_LABEL.indexOf(label) > -1) {
                    emotionPossibility.push('(悲伤/哭泣)')
                    tonePossibility.push('祥林嫂' + probabilityToPercent(probability))
                }
                // weight--
            }

            if (speech || sexPossibility.length || agePossibility.length) {
                document.getElementById('audio-sex').innerText = `性别：${sexPossibility.length ? sexPossibility.join('，') : '春哥???'}`
                document.getElementById('audio-age').innerText = `年龄：${agePossibility.length ? agePossibility.join('，') : '老顽童???'}`
                document.getElementById('audio-tone').innerText = `音色：${tonePossibility.length ? tonePossibility.join('，') : '平凡路人'}`
                document.getElementById('audio-emotion').innerText = `情绪：${emotionPossibility.length ? emotionPossibility.join('，') : '(莫得感情)'}`
            } else {
                alert('未检测到人声，请重新录入')
            }
            loading_end()
        } catch (e) {
            alert('服务异常，请稍后重试')
            loading_end()
        }
    }

    const downloadRecord = (file: any): void => {
        const link = document.createElement('a')
        link.href = URL.createObjectURL(file)
        link.download = 'audio'
        link.click()
    }

    const handleRecord = () => {
        loading_start()
        const pcm = mergePCM()
        const wav = createFile(pcm)

        // downloadRecord(wav)
        uploadRecord(SERVER_URL, wav, predictResultParseHandle, 'audio')
    }

    button.addEventListener('touchstart', function () {
        if (!granted) {
            return alert('请提供麦克风访问权限')
        }
        this.classList.add('active')
        getUserMedia({
            audio: {
                sampleRate: 44100,
                channelCount: CHANNEL_COUNT,
                volume: 1.0
            }
        }).then(mediaStream => {
            startTime = Date.now()
            audioCtx = new AudioContext()
            source = audioCtx.createMediaStreamSource(mediaStream)
            processor = audioCtx.createScriptProcessor(BUFFER_SIZE, CHANNEL_COUNT, CHANNEL_COUNT)
            msPointer = mediaStream
            processor.onaudioprocess = ({ inputBuffer }) => {
                SOUND_CHANNELS.forEach((c, i) => {
                    c.push(inputBuffer.getChannelData(i).slice(0))
                })
            }
            processor.connect(audioCtx.destination)
            source.connect(processor)
        }).catch(e => {
            console.error(e)
        })
    })

    button.addEventListener('touchend', function () {
        this.classList.remove('active')
        if (startTime) {
            if (Date.now() - startTime > 5000) {
                handleRecord()
            } else {
                alert('语音长度过短，请重新录音')
            }
        }
        reset()
    })
})()

