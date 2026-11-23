# MixPilot benchmark harness

Development-only tooling. Nothing in `bench/` ships in the extension. Results are in `docs/MODEL_BENCHMARK.md`.

## Setup (Windows)

```powershell
py -3.13 -m venv bench/.venv
bench/.venv/Scripts/python -m pip install numpy scipy soundfile onnxruntime pyarrow
py -3.11 -m venv bench/.venv-dfn      # DeepFilterLib has no cp313 Windows wheel
bench/.venv-dfn/Scripts/python -m pip install torch==2.0.1 torchaudio==2.0.2 --index-url https://download.pytorch.org/whl/cpu
bench/.venv-dfn/Scripts/python -m pip install "numpy<2" deepfilternet==0.5.6 onnx onnxruntime soundfile scipy
```

Download the models into `bench/models/`:
- `dfn3/`: [DeepFilterNet3_onnx.tar.gz](https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3_onnx.tar.gz), used for reference only
- `gtcrn/gtcrn_simple.onnx`: from [gtcrn/stream/onnx_models](https://github.com/Xiaobin-Rong/gtcrn/tree/main/stream/onnx_models)
- `sherpa-onnx-spleeter-2stems-fp16/`: from the [sherpa-onnx release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models)

Download the audio listed in `audio/SOURCES.md` into `bench/audio/raw/`. Wikimedia requires a policy-compliant User-Agent.

## Run

```powershell
bench/.venv/Scripts/python bench/make_mixtures.py                 # 28 mixtures -> audio/mix
bench/.venv-dfn/Scripts/python bench/sep_dfn.py                    # official DFN3 -> out/dfn3
bench/.venv-dfn/Scripts/python bench/export/export_dfn_stream.py   # streaming ONNX + validation -> models/dfn3_stream, out/dfn3_stream
bench/.venv/Scripts/python bench/sep_onnx.py gtcrn
bench/.venv/Scripts/python bench/sep_onnx.py spleeter2
bench/.venv/Scripts/python bench/score.py dfn3 dfn3_stream gtcrn spleeter2
node bench/web/serve.mjs   # then open http://127.0.0.1:8765/bench/web/bench.html?configs=wasm1
```

`export_dfn_stream.py` first needs `bench/export/df_patched/df`. That's a copy of the installed `df` package with `export/df_fork/{deepfilternet3,modules}.py` laid over it:

```bash
cp -r bench/.venv-dfn/Lib/site-packages/df bench/export/df_patched/df
cp bench/export/df_fork/*.py bench/export/df_patched/df/
```

## Third-party code in this folder

`export/torch_df_streaming.py` and `export/df_fork/*.py` come from [grazder/DeepFilterNet](https://github.com/grazder/DeepFilterNet/tree/torchDF-changes) (branch `torchDF-changes`), a fork of Rikorose/DeepFilterNet, licensed MIT OR Apache-2.0. The fork's changes only thread GRU hidden state through the encoder and decoders; the weights are the official DeepFilterNet3 checkpoint.

## Listening samples

`bench/listening/` holds 4 mixtures processed by the streaming ONNX graph: original mix, speech stem and music stem for each.
