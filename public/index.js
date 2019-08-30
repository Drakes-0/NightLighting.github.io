(function () {
    new VConsole();
    if (typeof Promise !== 'function' || typeof AudioContext !== 'function') {
        throw new Error('Old browser version detected. Please update your browser');
    }
    var getUserMedia = (navigator.mediaDevices
        && navigator.mediaDevices.getUserMedia
        && navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)) || (function (constraints) {
        var privateFunc = navigator.getUserMedia
            || navigator.webkitGetUserMedia
            || navigator.mozGetUserMedia
            || navigator.msGetUserMedia;
        if (!privateFunc) {
            return Promise.reject(new Error('GetUserMedia is not supported'));
        }
        return new Promise(function (resolve, reject) {
            privateFunc.call(navigator, constraints, resolve, reject);
        });
    });
    var SERVER_URL = 'https://35.192.32.244/model/predict?start_time=0';
    var button = document.getElementById('audio-button');
    var BUFFER_SIZE = 4096;
    var CHANNEL_COUNT = 2;
    var SOUND_CHANNELS = [[], []];
    var GENDER_MALE_LABEL = ['/m/05zppz', '/t/dd00003'];
    var GENDER_FEMALE_LABEL = ['/m/02zsn', '/t/dd00004'];
    var AGE_ADULT_LABEL = ['/m/05zppz', '/m/02zsn', '/t/dd00003', '/t/dd00004'];
    var GENDER_NEUTRAL_LABEL = ['/m/0ytgt', '/m/0261r1', '/t/dd00135', '/t/dd00001', '/t/dd00002', '/t/dd00005', '/t/dd00013'];
    var AGE_NONAGE_LABEL = ['/m/0ytgt', '/m/0261r1', '/t/dd00135', '/t/dd00001', '/t/dd00002', '/t/dd00005', '/t/dd00013'];
    var EMOTION_ANGER_LABEL = ['/m/07p6fty', '/m/07q4ntr', '/t/dd00135', '/m/03qc9zr', '/m/07qf0zm', '/m/0ghcn6'];
    var EMOTION_EXCITED_LABEL = ['/m/07p6fty', '/m/07rwj3x', '/m/04gy_2', '/t/dd00135', '/m/03qc9zr', '/m/053hz1', '/m/028ght'];
    var EMOTION_LAUGH_LABEL = ['/m/01j3sz', '/t/dd00001', '/m/07r660_', '/m/07s04w4', '/m/07sq110', '/m/07rgt08'];
    var EMOTION_CRY_LABEL = ['/m/0463cq4', '/t/dd00002', '/m/07qz6j3'];
    var granted = false;
    var startTime = null;
    var audioCtx = null;
    var source = null;
    var processor = null;
    var msPointer = null;
    window.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });
    var askForPermission = function () {
        getUserMedia({ audio: true }).then(function (ms) {
            ms.getAudioTracks()[0].stop();
            granted = true;
        }).catch(console.error);
    };
    if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' }).then(function (result) {
            if (result.state === 'granted') {
                granted = true;
            }
            else if (result.state === 'prompt') {
                askForPermission();
            }
        }).catch(function (e) {
            console.error(e);
            askForPermission();
        });
    }
    else {
        askForPermission();
    }
    var reset = function () {
        if (msPointer) {
            msPointer.getAudioTracks()[0].stop();
            msPointer = null;
        }
        if (source) {
            source.disconnect();
            source = null;
        }
        if (processor) {
            processor.disconnect();
            processor = null;
        }
        if (audioCtx) {
            audioCtx = null;
        }
        if (startTime) {
            startTime = null;
        }
        SOUND_CHANNELS.forEach(function (c) {
            c.length = 0;
        });
    };
    var mergeChannel = function (channel) {
        var length = channel.length;
        var data = new Float32Array(length * BUFFER_SIZE);
        var offset = 0;
        for (var i = 0; i < length; i++) {
            data.set(channel[i], offset);
            offset += BUFFER_SIZE;
        }
        return data;
    };
    var mergePCM = function () {
        var left = mergeChannel(SOUND_CHANNELS[0]);
        var right = mergeChannel(SOUND_CHANNELS[1]);
        var length = Math.floor(left.length / 44100) * 44100;
        var data = new Float32Array(length * 2);
        for (var i = 0; i < length; i++) {
            var j = i * 2;
            data[j] = left[i];
            data[j + 1] = right[i];
        }
        return data;
    };
    var writeUTFBytes = function (view, offset, string) {
        var length = string.length;
        for (var i = 0; i < length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    var createFile = function (audioData) {
        var WAV_HEAD_SIZE = 44;
        var TOTAL_SIZE = audioData.length * 2 + WAV_HEAD_SIZE;
        var buffer = new ArrayBuffer(TOTAL_SIZE);
        var view = new DataView(buffer);
        writeUTFBytes(view, 0, 'RIFF');
        view.setUint32(4, TOTAL_SIZE - 8, true);
        writeUTFBytes(view, 8, 'WAVE');
        writeUTFBytes(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, 44100, true);
        view.setUint32(28, 44100 * 2 * 2, true);
        view.setUint16(32, 2 * 2, true);
        view.setUint16(34, 16, true);
        writeUTFBytes(view, 36, 'data');
        view.setUint32(40, TOTAL_SIZE - WAV_HEAD_SIZE, true);
        var index = WAV_HEAD_SIZE;
        var volume = 1;
        for (var i = 0, l = audioData.length; i < l; i++) {
            view.setInt16(index, audioData[i] * 32767 * volume, true);
            index += 2;
        }
        return new Blob([new Uint8Array(buffer)], { type: 'audio/x-wav' });
    };
    var uploadRecord = function (url, file, callback, fileField) {
        if (fileField === void 0) { fileField = 'file'; }
        var formData = new FormData();
        formData.append(fileField, file);
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                callback(xhr.responseText);
            }
        };
        xhr.open('POST', url, true);
        xhr.setRequestHeader('accept', 'application/json');
        xhr.send(formData);
    };
    var predictResultParseHandle = function (result) {
        try {
            var predictResult = JSON.parse(result).predictions;
            var sex = [];
            var age = [];
            var emotion = [];
            var background = [];
            var weight = predictResult.length;
        }
        catch (e) {
        }
    };
    var downloadRecord = function (file) {
        var link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        link.download = 'audio';
        link.click();
    };
    var handleRecord = function () {
        var pcm = mergePCM();
        var wav = createFile(pcm);
        uploadRecord(SERVER_URL, wav, predictResultParseHandle, 'audio');
    };
    button.addEventListener('touchstart', function () {
        if (!granted) {
            return alert('请提供麦克风访问权限');
        }
        this.classList.add('active');
        getUserMedia({
            audio: {
                sampleRate: 44100,
                channelCount: CHANNEL_COUNT,
                volume: 1.0
            }
        }).then(function (mediaStream) {
            startTime = Date.now();
            audioCtx = new AudioContext();
            source = audioCtx.createMediaStreamSource(mediaStream);
            processor = audioCtx.createScriptProcessor(BUFFER_SIZE, CHANNEL_COUNT, CHANNEL_COUNT);
            msPointer = mediaStream;
            processor.onaudioprocess = function (_a) {
                var inputBuffer = _a.inputBuffer;
                SOUND_CHANNELS.forEach(function (c, i) {
                    c.push(inputBuffer.getChannelData(i).slice(0));
                });
            };
            processor.connect(audioCtx.destination);
            source.connect(processor);
        }).catch(function (e) {
            console.error(e);
        });
    });
    button.addEventListener('touchend', function () {
        this.classList.remove('active');
        if (startTime) {
            if (Date.now() - startTime > 5000) {
                handleRecord();
            }
            else {
                alert('语音长度过短，请重新录音');
            }
        }
        reset();
    });
})();
