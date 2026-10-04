Plain prefix:value and scope:unknown remain complete.

Unknown :widget[label]{color="blue"} remains literal.

::widget[Leaf label]{color="blue"}

:::widget[Container label]{color="blue"}
Container body with **original markup**.
:::

Inline `a < b` and ``<em>with `ticks`</em>`` remain code.

~~~html
<div>tilde code</div>
[code example](javascript:literal)
~~~

````html
```
<div>long fence code</div>
````

    <div>indented code</div>

> ~~~html
> <div>quoted code</div>
> ~~~

<script>alert('raw html')</script>

Inline <img src="x" onerror="alert(1)"> and <em>HTML text</em> stay literal.

[inline](javascript:alert%281%29)
[entity](jav&#x61;script:alert%281%29)
[control](java&#x09;script:alert%281%29)
[reference][blocked]
![image][blocked-image]
<javascript:alert%281%29>

[blocked]: javascript:alert%281%29
[blocked-image]: data:image/svg+xml,test

[safe](https://example.com/)
[email](mailto:writer@example.com)
[relative](/blog/other/)
